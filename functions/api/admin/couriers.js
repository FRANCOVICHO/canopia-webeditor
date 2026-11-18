import { assertAdmin } from './_auth.js';
import { ADMIN_ACCOUNT, dbFor, json, failure, configuration, errorResponse, bodyJson, field, randomToken, hashPassword, assertChanged, atomic, deliveryEvent, statuses } from '../../_lib/couriers.js';

function accountFields(body) {
  const values = ['username','name','phone','email','zone','vehicle','notes'].map((key,i)=>field(body,key,[64,100,40,254,160,100,1000][i],i<2));
  values[0] = values[0].toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(values[0])) failure('Usuario: entre 3 y 64 letras, números, puntos, guiones o guiones bajos.');
  if (values[3] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[3])) failure('Email inválido.');
  for (const key of ['active','can_update_status','can_view_phone']) if (typeof body[key] !== 'boolean') failure('Revisá los permisos de la cuenta.');
  if (!Number.isSafeInteger(body.session_hours) || body.session_hours<1 || body.session_hours>24) failure('La sesión debe durar entre 1 y 24 horas.');
  return [...values,Number(body.active),Number(body.can_update_status),Number(body.can_view_phone),body.session_hours];
}
function deliveryFields(body) {
  const values = ['courier_id','customer_name','customer_phone','address','city','details','contents'].map((key,i)=>field(body,key,[64,120,40,300,120,1000,2000][i],[0,1,3].includes(i)));
  if (!Number.isSafeInteger(body.collect_cents) || body.collect_cents<0 || body.collect_cents>10000000000) failure('Importe a cobrar inválido.');
  if (!['pagado','efectivo','transferencia'].includes(body.payment_method)) failure('Forma de pago inválida.');
  if (body.payment_method === 'pagado' && body.collect_cents !== 0) failure('Un pedido pagado debe tener importe a cobrar cero.');
  if (!['normal','urgente'].includes(body.priority)) failure('Prioridad inválida.');
  const scheduled = field(body,'scheduled_at',40);
  if (scheduled && (!Number.isFinite(Date.parse(scheduled)) || !scheduled.endsWith('Z'))) failure('Fecha de entrega inválida.');
  return [...values,body.collect_cents,body.payment_method,body.priority,scheduled];
}
export async function onRequest({request,env}) {
  const denied = assertAdmin(request,env);
  if (denied) return denied;
  try {
    configuration(env);
    const db = dbFor(env), url = new URL(request.url), action = url.searchParams.get('action') || 'overview';
    if (request.method === 'GET' && action === 'overview') {
      const [accounts,deliveries] = await Promise.all([
        db.prepare(`SELECT ${ADMIN_ACCOUNT} FROM couriers ORDER BY active DESC,name`).all(),
        db.prepare(`SELECT d.*,c.name AS courier_name FROM deliveries d JOIN couriers c ON c.id=d.courier_id
          ORDER BY CASE WHEN d.status IN ('pendiente','en_camino') THEN 0 ELSE 1 END,d.created_at DESC LIMIT 250`).all(),
      ]);
      return json({couriers:accounts.results,deliveries:deliveries.results});
    }
    if (request.method === 'GET' && action === 'events') {
      const id = url.searchParams.get('id') || '';
      const {results} = await db.prepare('SELECT * FROM delivery_events WHERE delivery_id=? ORDER BY id DESC LIMIT 100').bind(id).all();
      return json({events:results});
    }
    if (request.method !== 'POST') return json({error:'Acción no encontrada.'},404);
    const body = await bodyJson(request);
    if (action === 'account') {
      const values = accountFields(body), id = body.id ? field(body,'id',64,true) : crypto.randomUUID();
      const old = body.id ? await db.prepare('SELECT * FROM couriers WHERE id=?').bind(id).first() : null;
      if (body.id && !old) failure('Cuenta no encontrada.',404);
      const existing = await db.prepare('SELECT id FROM couriers WHERE username=? COLLATE NOCASE AND id<>?').bind(values[0],id).first();
      if (existing) failure('Ese nombre de usuario ya está en uso.',409);
      const passwordHash = body.password ? await hashPassword(body.password,env) : old?.password_hash;
      if (!passwordHash) failure('Ingresá una contraseña de al menos 12 caracteres.');
      if (old) {
        if (!Number.isSafeInteger(body.version)) failure('Falta la versión de la cuenta.');
        await atomic(db,[
          db.prepare(`UPDATE couriers SET username=?,name=?,phone=?,email=?,zone=?,vehicle=?,notes=?,active=?,
            can_update_status=?,can_view_phone=?,session_hours=?,password_hash=?,version=version+1,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND version=?`).bind(...values,passwordHash,id,body.version),assertChanged(db),
          db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').bind(id),
        ]);
      } else {
        await db.prepare(`INSERT INTO couriers(id,username,name,phone,email,zone,vehicle,notes,active,can_update_status,can_view_phone,session_hours,password_hash,access_key)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,...values,passwordHash,randomToken()).run();
      }
      return json({ok:true,id},old ? 200 : 201);
    }
    if (action === 'revoke' || action === 'rotate-link') {
      const id = field(body,'id',64,true);
      const account = await db.prepare('SELECT id FROM couriers WHERE id=?').bind(id).first();
      if (!account) failure('Cuenta no encontrada.',404);
      if (action === 'revoke') await db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').bind(id).run();
      else await db.prepare('UPDATE couriers SET access_key=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(randomToken(),id).run();
      return json({ok:true});
    }
    if (action === 'delivery') {
      const values = deliveryFields(body), id = body.id ? field(body,'id',64,true) : crypto.randomUUID();
      const courier = await db.prepare('SELECT id,active FROM couriers WHERE id=?').bind(values[0]).first();
      if (!courier?.active) failure('Elegí un repartidor activo.');
      const old = body.id ? await db.prepare('SELECT * FROM deliveries WHERE id=?').bind(id).first() : null;
      if (body.id && !old) failure('Entrega no encontrada.',404);
      const status = old ? field(body,'status',32,true) : 'pendiente';
      if (!statuses.includes(status)) failure('Estado inválido.');
      const note = field(body,'result_note',500);
      if (status === 'no_entregado' && !note) failure('Falta el motivo de la entrega fallida.');
      // Linking a sale never confirms it or changes inventory.
      let orderId = old?.order_id ?? null;
      if (!old && body.order_id) {
        if (!Number.isSafeInteger(body.order_id) || body.order_id<1) failure('Número de compra inválido.');
        const sale = await db.prepare("SELECT id,status FROM orders WHERE id=?").bind(body.order_id).first();
        if (sale?.status !== 'confirmado') failure('Primero confirmá la compra desde Pedidos.');
        const linked = await db.prepare('SELECT id FROM deliveries WHERE order_id=?').bind(body.order_id).first();
        if (linked) failure('Esta compra ya tiene una entrega. Editala desde Repartidores.',409);
        orderId = body.order_id;
      }
      if (old) {
        if (!Number.isSafeInteger(body.version)) failure('Falta la versión de la entrega.');
        await atomic(db,[
          db.prepare(`UPDATE deliveries SET courier_id=?,customer_name=?,customer_phone=?,address=?,city=?,details=?,contents=?,
            collect_cents=?,payment_method=?,priority=?,scheduled_at=?,status=?,result_note=?,version=version+1,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM couriers WHERE id=? AND active=1)`)
            .bind(...values,status,note,id,body.version,values[0]),assertChanged(db),
          deliveryEvent(db,id,'admin',old.courier_id === values[0] ? 'edit' : 'reassign',old.status,status,
            `${note}${old.courier_id !== values[0] ? ` [${old.courier_id} → ${values[0]}]` : ''}`),
        ]);
      } else {
        await atomic(db,[
          db.prepare(`INSERT INTO deliveries(id,order_id,courier_id,customer_name,customer_phone,address,city,details,contents,collect_cents,payment_method,priority,scheduled_at)
            SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM couriers WHERE id=? AND active=1)`)
            .bind(id,orderId,...values,values[0]),assertChanged(db),deliveryEvent(db,id,'admin','create',null,'pendiente'),
        ]);
      }
      return json({ok:true,id},old ? 200 : 201);
    }
    return json({error:'Acción no encontrada.'},404);
  } catch(error) {
    if (/UNIQUE constraint failed/i.test(error.message)) return json({error:'El usuario o la compra ya están registrados. Actualizá los datos.'},409);
    return errorResponse(error);
  }
}
