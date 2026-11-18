const root=document.querySelector('#section-couriers');
const $=selector=>root.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={pendiente:'Pendiente',en_camino:'En camino',entregado:'Entregado',no_entregado:'No entregado',cancelado:'Cancelado'};
const money=new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'});
const storeOrigin='https://canopiagrow.com';
let accounts=[],deliveries=[],tab='deliveries',timer,busy=false,signature='',editing=null;
root.innerHTML=`<div class="ca-toolbar"><div><h2>El equipo, en movimiento.</h2><p>Creá una entrega y asignala. El repartidor la ve en su panel.</p></div><div class="ca-actions"><button type="button" class="btn-ghost" id="ca-new-account">+ Repartidor</button><button type="button" class="btn-primary" id="ca-new-delivery">+ Nueva entrega</button></div></div><p class="ca-note">Acceso privado: copiá el enlace de cada cuenta y compartilo con su repartidor. El enlace habilita el botón junto a Mi cuenta; siempre se piden usuario y contraseña. Al guardar una cuenta se cierran sus sesiones abiertas.</p><div class="ca-tabs"><button type="button" class="btn-ghost" data-tab="deliveries" aria-pressed="true">Entregas</button><button type="button" class="btn-ghost" data-tab="accounts" aria-pressed="false">Cuentas del equipo</button><button type="button" class="btn-ghost" id="ca-refresh">Actualizar</button></div><div class="ca-filters"><input id="ca-search" type="search" placeholder="Buscar nombre, dirección o usuario" aria-label="Buscar en repartidores"><select id="ca-status" aria-label="Estado de entrega"><option value="active">Pendientes y en camino</option><option value="all">Todos los estados</option>${Object.entries(labels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><select id="ca-assignee" aria-label="Filtrar por repartidor"><option value="">Todo el equipo</option></select></div><p class="ca-feedback" id="ca-feedback" role="status"></p><p class="ca-sync" id="ca-sync" role="status">Conectando…</p><div class="ca-grid" id="ca-list"></div>`;
const dialog=document.createElement('dialog');dialog.className='ca-dialog';document.body.append(dialog);
async function api(action='overview',body){
  const options=body?{method:'POST',body:JSON.stringify(body)}:{};
  return window.api(`/api/admin/couriers?action=${action}`,{...options,signal:AbortSignal.timeout(12000),cache:'no-store'});
}
function active(){return !root.hidden&&!document.querySelector('#admin').hidden;}
function schedule(){clearTimeout(timer);if(active())timer=setTimeout(load,document.hidden?30000:3000);}
async function load(){
  if(!active()||busy){schedule();return;}busy=true;
  try{
    const data=await api();accounts=data.couriers;deliveries=data.deliveries;
    const current=$('#ca-assignee').value;
    $('#ca-assignee').innerHTML='<option value="">Todo el equipo</option>'+accounts.map(c=>`<option value="${escape(c.id)}">${escape(c.name)}${c.active?'':' (suspendido)'}</option>`).join('');$('#ca-assignee').value=current;
    $('#ca-sync').textContent=`Actualizado ${new Date().toLocaleTimeString('es-AR')} · consulta cada 3 s · hasta 250 entregas`;
    render();
  }catch(error){$('#ca-sync').textContent=`No se pudo actualizar: ${error.message}`;}
  finally{busy=false;schedule();}
}
function render(){
  $('#ca-status').hidden=tab==='accounts';$('#ca-assignee').hidden=tab==='accounts';
  const search=$('#ca-search').value.trim().toLowerCase(),status=$('#ca-status').value,courier=$('#ca-assignee').value;
  const next=JSON.stringify([accounts,deliveries,tab,search,status,courier]);if(next===signature)return;signature=next;
  const focused=document.activeElement,focusId=focused?.dataset.id,focusAction=focused?.dataset.action;
  const list=tab==='accounts'?accounts.filter(c=>`${c.name} ${c.username} ${c.zone}`.toLowerCase().includes(search)):
    deliveries.filter(d=>(!courier||d.courier_id===courier)&&(status==='all'||(status==='active'?['pendiente','en_camino'].includes(d.status):d.status===status))&&`${d.customer_name} ${d.address} ${d.courier_name} ${d.order_id||d.id}`.toLowerCase().includes(search));
  $('#ca-list').innerHTML=list.length?list.map(item=>tab==='accounts'?accountCard(item):deliveryCard(item)).join(''):
    `<div class="ca-empty"><h3>${tab==='accounts'?'Sumá al primer repartidor.':'No hay entregas para este filtro.'}</h3><p class="ca-muted">${tab==='accounts'?'Creá una cuenta privada y configurá sus permisos.':'Podés crear una entrega manual o vincular una compra confirmada.'}</p></div>`;
  if(focusId)[...$('#ca-list').querySelectorAll('button')].find(b=>b.dataset.id===focusId&&b.dataset.action===focusAction)?.focus({preventScroll:true});
}
function accountCard(c){return `<article class="ca-card"><div class="ca-card-top"><span>@${escape(c.username)}</span><span class="ca-pill ${c.active?'':'off'}">${c.active?'Activo':'Suspendido'}</span></div><h3>${escape(c.name)}</h3><p>${escape([c.zone,c.vehicle].filter(Boolean).join(' · ')||'Sin zona o vehículo configurado')}</p><p class="ca-muted">${escape(c.phone||'Sin teléfono')} · Sesión: ${c.session_hours} h<br>Estados: ${c.can_update_status?'puede actualizar':'solo lectura'} · Teléfonos de clientes: ${c.can_view_phone?'visibles':'ocultos'}</p><div class="ca-actions"><button class="btn-primary" type="button" data-action="edit-account" data-id="${escape(c.id)}">Configurar</button><button class="btn-ghost" type="button" data-action="link" data-id="${escape(c.id)}">Enlace privado</button><button class="btn-ghost" type="button" data-action="revoke" data-id="${escape(c.id)}">Cerrar sesiones</button></div></article>`;}
function deliveryCard(d){return `<article class="ca-card"><div class="ca-card-top"><span>${d.order_id?`COMPRA #${escape(d.order_id)}`:`ENVÍO ${escape(d.id.slice(0,8))}`}${d.priority==='urgente'?' · URGENTE':''}</span><span class="ca-pill">${labels[d.status]}</span></div><h3>${escape(d.customer_name)}</h3><p>${escape([d.address,d.city].filter(Boolean).join(', '))}</p><p class="ca-muted">Asignado a ${escape(d.courier_name)}${d.scheduled_at?`<br>${escape(new Date(d.scheduled_at).toLocaleString('es-AR'))}`:''}</p><p class="ca-card-total">${d.payment_method==='pagado'?'Pagado':`Cobrar ${money.format(d.collect_cents/100)} · ${escape(d.payment_method)}`}</p>${d.result_note?`<p>${escape(d.result_note)}</p>`:''}<div class="ca-actions"><button class="btn-primary" type="button" data-action="edit-delivery" data-id="${escape(d.id)}">Editar / reasignar</button><button class="btn-ghost" type="button" data-action="events" data-id="${escape(d.id)}">Ver movimientos</button></div></article>`;}
function openDialog(title,body,submit='Guardar'){
  dialog.innerHTML=`<form id="ca-form"><div class="ca-dialog-header"><h2>${title}</h2><button type="button" class="btn-ghost" data-close aria-label="Cerrar formulario">Cerrar</button></div><div class="ca-form-body">${body}</div><div class="ca-dialog-footer"><p class="ca-feedback" role="status" id="ca-dialog-feedback"></p><button type="button" class="btn-ghost" data-close>Volver</button>${submit?`<button type="submit" class="btn-primary">${submit}</button>`:''}</div></form>`;
  dialog.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>dialog.close()));if(!dialog.open)dialog.showModal();
}
const input=(name,label,value='',max=160,required=false,type='text')=>`<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" maxlength="${max}" ${required?'required':''}></label>`;
function accountForm(account){
  editing=account?{...account}:null;
  openDialog(account?'Configurar repartidor':'Nueva cuenta de repartidor',`<div class="ca-form-grid">${input('name','Nombre completo',account?.name,100,true)}${input('username','Usuario de acceso',account?.username,64,true)}${input('phone','Teléfono',account?.phone,40,false,'tel')}${input('email','Email de contacto',account?.email,254,false,'email')}${input('zone','Zona de reparto',account?.zone,160)}${input('vehicle','Vehículo',account?.vehicle,100)}<label>Duración de sesión (horas)<input name="session_hours" type="number" min="1" max="24" step="1" value="${account?.session_hours||12}" required></label><label>${account?'Nueva contraseña (vacío = conservar)':'Contraseña inicial'}<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" ${account?'':'required'}><small class="ca-muted">Entre 12 y 128 caracteres. No se puede consultar la contraseña guardada.</small></label></div><h3>Acceso y permisos</h3><label class="ca-check"><input name="active" type="checkbox" ${!account||account.active?'checked':''}> Cuenta habilitada</label><label class="ca-check"><input name="can_update_status" type="checkbox" ${!account||account.can_update_status?'checked':''}> Puede cambiar el estado de sus entregas</label><label class="ca-check"><input name="can_view_phone" type="checkbox" ${!account||account.can_view_phone?'checked':''}> Puede ver y llamar al teléfono del cliente</label><label>Notas internas<textarea name="notes" maxlength="1000" rows="3">${escape(account?.notes)}</textarea><small class="ca-muted">Estas notas no se muestran al repartidor.</small></label><p class="ca-muted">Guardar cierra las sesiones de esta cuenta. Suspender conserva el historial; revisá sus entregas activas para reasignarlas.</p>`,account?'Guardar configuración':'Crear cuenta');
  bindSave(async form=>{
    const body=Object.fromEntries(new FormData(form));for(const key of ['active','can_update_status','can_view_phone'])body[key]=form.elements[key].checked;
    body.session_hours=Number(body.session_hours);if(editing){body.id=editing.id;body.version=editing.version;}
    await api('account',body);
  },account?'Cuenta actualizada. Las sesiones anteriores se cerraron.':'Cuenta creada. Ya podés copiar su enlace privado.');
}
function localDate(value){if(!value)return '';const d=new Date(value);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function deliveryForm(delivery){
  editing=delivery?{...delivery}:null;
  openDialog(delivery?'Editar entrega':'Nueva entrega',`<p class="ca-muted">Una entrega manual no modifica ventas ni descuenta stock. Para vincular una compra, primero confirmala desde Pedidos.</p><div class="ca-form-grid"><label>Repartidor<select name="courier_id" required><option value="">Elegir repartidor</option>${accounts.filter(c=>c.active||c.id===delivery?.courier_id).map(c=>`<option value="${escape(c.id)}" ${c.id===delivery?.courier_id?'selected':''} ${c.active?'':'disabled'}>${escape(c.name)}${c.active?'':' (suspendido)'}</option>`).join('')}</select></label>${delivery?`<label>Estado<select name="status">${Object.entries(labels).map(([value,label])=>`<option value="${value}" ${value===delivery.status?'selected':''}>${label}</option>`).join('')}</select></label>`:input('order_id','N.º de compra confirmada (opcional)','',16,false,'number')}${input('customer_name','Nombre del cliente',delivery?.customer_name,120,true)}${input('customer_phone','Teléfono del cliente',delivery?.customer_phone,40,false,'tel')}${input('address','Dirección completa',delivery?.address,300,true)}${input('city','Ciudad',delivery?.city,120)}<label>Forma de pago<select name="payment_method"><option value="pagado">Ya está pagado</option><option value="efectivo">Cobrar efectivo</option><option value="transferencia">Verificar transferencia</option></select></label><label>Importe a cobrar (ARS)<input name="collect_amount" type="number" min="0" max="100000000" step="0.01" value="${(delivery?.collect_cents||0)/100}" required></label><label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="urgente">Urgente</option></select></label><label>Fecha y hora prevista<input name="scheduled_at" type="datetime-local" value="${localDate(delivery?.scheduled_at)}"></label></div><label>Qué lleva / detalle del paquete<textarea name="contents" rows="3" maxlength="2000">${escape(delivery?.contents)}</textarea></label><label>Indicaciones para la entrega<textarea name="details" rows="3" maxlength="1000">${escape(delivery?.details)}</textarea></label>${delivery?`<label>Resultado o motivo de entrega fallida<textarea name="result_note" rows="2" maxlength="500">${escape(delivery.result_note)}</textarea></label>`:''}` ,delivery?'Guardar cambios':'Crear y asignar');
  const form=dialog.querySelector('form');form.elements.payment_method.value=delivery?.payment_method||'pagado';form.elements.priority.value=delivery?.priority||'normal';
  if(!delivery){form.elements.order_id.addEventListener('change',async()=>{
    const id=Number(form.elements.order_id.value);if(!id)return;
    try{const data=await window.api('/api/admin/orders?status=confirmado');const order=data.orders.find(o=>o.id===id);if(!order)throw new Error('No se encontró entre las últimas compras confirmadas. Revisá Pedidos.');
      form.elements.customer_name.value=order.customer_name;form.elements.customer_phone.value=order.customer_phone;
      form.elements.contents.value=JSON.parse(order.items_json).map(i=>`${i.quantity} × ${i.name}`).join('\n');
      dialog.querySelector('#ca-dialog-feedback').textContent='Compra vinculada. Completá dirección y confirmá el cobro; la compra confirmada no indica que ya esté pagada.';
    }catch(error){dialog.querySelector('#ca-dialog-feedback').textContent=error.message;}
  });}
  bindSave(async form=>{
    const body=Object.fromEntries(new FormData(form));
    const amount=body.collect_amount;if(!/^\d+(\.\d{1,2})?$/.test(amount))throw new Error('Ingresá un importe con hasta dos decimales.');
    body.collect_cents=Math.round(Number(amount)*100);delete body.collect_amount;
    body.scheduled_at=body.scheduled_at?new Date(body.scheduled_at).toISOString():'';
    if(editing){body.id=editing.id;body.version=editing.version;}else{body.order_id=body.order_id?Number(body.order_id):null;}
    await api('delivery',body);
  },delivery?'Entrega actualizada.':'Entrega creada y asignada.');
}
function bindSave(save,message){
  dialog.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();event.submitter.disabled=true;
    try{await save(event.target);dialog.close();$('#ca-feedback').textContent=message;await load();}
    catch(error){dialog.querySelector('#ca-dialog-feedback').textContent=error.message;}
    finally{event.submitter.disabled=false;}
  });
}
root.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const {action,id}=button.dataset,account=accounts.find(c=>c.id===id),delivery=deliveries.find(d=>d.id===id);
  try{
    if(action==='edit-account')accountForm(account);
    if(action==='edit-delivery')deliveryForm(delivery);
    if(action==='revoke'){
      openDialog('Cerrar sesiones',`<p>Se cerrarán las sesiones de <strong>${escape(account.name)}</strong>. Va a tener que ingresar nuevamente con sus credenciales.</p>`,'Cerrar todas las sesiones');
      bindSave(()=>api('revoke',{id}),'Sesiones cerradas.');
    }
    if(action==='link'){
      const link=`${storeOrigin}/repartidores.html?access=${account.access_key}`;
      openDialog('Enlace privado',`<p class="ca-muted">Para ${escape(account.name)}. Compartí también su usuario y la contraseña que configuraste. El enlace por sí solo no permite ver pedidos.</p><p class="ca-link-box">${escape(link)}</p><div class="ca-actions"><button type="button" class="btn-primary" id="ca-copy-link">Copiar enlace</button><button type="button" class="btn-ghost" id="ca-rotate-link">Invalidar y generar otro</button></div>`,null);
      dialog.querySelector('#ca-copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(link);dialog.querySelector('#ca-dialog-feedback').textContent='Enlace copiado.';}catch{dialog.querySelector('#ca-dialog-feedback').textContent='Seleccioná el enlace de arriba y copialo.';}});
      dialog.querySelector('#ca-rotate-link').addEventListener('click',()=>{
        openDialog('Invalidar enlace privado',`<p>El enlace anterior de ${escape(account.name)} dejará de habilitar el acceso. Sus credenciales se conservan.</p>`,'Generar otro enlace');
        bindSave(()=>api('rotate-link',{id}),'Enlace renovado. Abrí Enlace privado para copiar el nuevo.');
      });
    }
    if(action==='events'){
      button.disabled=true;const data=await api(`events&id=${encodeURIComponent(id)}`);
      openDialog('Movimientos de la entrega',`<ol class="ca-events">${data.events.map(e=>`<li><strong>${escape(labels[e.new_status]||e.action)}</strong> · ${e.actor==='admin'?'Administración':'Repartidor'}<br><span class="ca-muted">${escape(e.created_at)} UTC · ${escape(e.action)}${e.note?` · ${escape(e.note)}`:''}</span></li>`).join('')||'<li>Sin movimientos.</li>'}</ol>`,null);
    }
  }catch(error){$('#ca-feedback').textContent=error.message;}finally{button.disabled=false;}
});
$('#ca-new-account').addEventListener('click',()=>accountForm());$('#ca-new-delivery').addEventListener('click',()=>deliveryForm());$('#ca-refresh').addEventListener('click',load);
root.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{tab=button.dataset.tab;root.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',b===button));render();}));
for(const id of ['#ca-search','#ca-status','#ca-assignee'])$(id).addEventListener('input',render);
new MutationObserver(()=>{if(active())load();else clearTimeout(timer);}).observe(root,{attributes:true,attributeFilter:['hidden']});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active())load();});addEventListener('online',()=>{if(active())load();});
if(active())load();
