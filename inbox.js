(()=>{
  const $=s=>document.querySelector(s);
  const cfg=window.APP_SUPABASE;
  if(!cfg||!window.supabase){$('#inboxButton').onclick=()=>alert('El buzón necesita conexión. Vuelve a abrir la app cuando tengas internet; el resto sigue disponible.');return}
  const db=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{storageKey:'luz-recipient-session',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const panel=$('#inboxPanel'),popup=$('#dailyMessagePopup'),list=$('#inboxList'),badge=$('#inboxBadge');
  let messages=[],activeMessage=null,loading=false,approved=false,renderedSignature=null;
  const storedSet=key=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return new Set(Array.isArray(value)?value:[])}catch{return new Set()}};
  const readSet=()=>storedSet('luz-inbox-read');
  const hiddenSet=()=>storedSet('luz-inbox-hidden');
  const saveSet=(key,set)=>localStorage.setItem(key,JSON.stringify([...set]));
  const today=()=>{const d=new Date(),o=d.getTimezoneOffset();return new Date(d-o*60000).toISOString().slice(0,10)};
  const prettyDate=v=>new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));
  const openLayer=el=>{el.hidden=false;document.body.classList.add('modal-open');$('.app').inert=true;$('nav').inert=true;el.querySelector('.icon-close').focus()};
  const closeLayer=el=>{el.hidden=true;if(panel.hidden&&popup.hidden){document.body.classList.remove('modal-open');$('.app').inert=false;$('nav').inert=false;$('#inboxButton').focus()}};

  async function ensureDevice(){
    let {data:{session}}=await db.auth.getSession();
    if(!session){const result=await db.auth.signInAnonymously();if(result.error)throw result.error;session=result.data.session}
    const userId=session.user.id;
    $('#deviceCode').textContent=userId.slice(0,8).toUpperCase();
    const {data:device,error:readError}=await db.from('devices').select('approved').eq('user_id',userId).maybeSingle();
    if(readError)throw readError;
    if(!device){
      const {error}=await db.from('devices').insert({user_id:userId,device_name:/iPhone|iPad/.test(navigator.userAgent)?'iPhone / iPad':'Otro dispositivo'});
      if(error&&error.code!=='23505')throw error;
      return false;
    }
    return device.approved;
  }
  async function signedPhoto(path){if(!path)return null;const {data}=await db.storage.from('daily-photos').createSignedUrl(path,3600);return data?.signedUrl||null}
  function updateBadge(){
    const read=readSet(),hidden=hiddenSet(),count=messages.filter(m=>!read.has(m.id)&&!hidden.has(m.id)).length;
    badge.textContent=count>9?'9+':count;badge.hidden=count===0;
  }
  async function createMessageCard(msg,forPopup=false){
    const card=document.createElement(forPopup?'article':'details');card.className=forPopup?'letter letter-popup':'letter letter-fold';card.dataset.messageId=msg.id;
    const date=document.createElement(forPopup?'div':'summary');date.className='letter-date';date.textContent=prettyDate(msg.message_date);
    const content=document.createElement('div');content.className='letter-content';
    const body=document.createElement('p');body.className='letter-text';body.textContent=msg.body;content.appendChild(body);card.append(date,content);
    let photoLoaded=false,photoLoading=false;
    async function loadPhoto(){
      if(!msg.photo_path||photoLoaded||photoLoading)return;photoLoading=true;
      try{const url=await signedPhoto(msg.photo_path);if(url){const img=document.createElement('img');img.className='letter-photo';img.src=url;img.alt='Fotografía que acompaña al mensaje';content.appendChild(img);photoLoaded=true}}finally{photoLoading=false}
    }
    if(forPopup)await loadPhoto();
    if(!forPopup){
      const remove=document.createElement('button');remove.className='letter-delete';remove.type='button';remove.textContent='Eliminar de mi bandeja';remove.onclick=()=>hideMessage(msg.id,card);card.appendChild(remove);
      card.addEventListener('toggle',()=>{if(card.open){markRead(msg.id);loadPhoto().catch(()=>{});}});
    }
    return card;
  }
  async function renderInbox(){
    const hidden=hiddenSet(),visible=messages.filter(m=>!hidden.has(m.id));
    const signature=JSON.stringify(visible);if(signature===renderedSignature)return;
    const openIds=new Set([...list.querySelectorAll('details[open]')].map(d=>d.dataset.messageId));
    list.replaceChildren();renderedSignature=signature;
    if(!visible.length){list.innerHTML='<div class="inbox-empty"><span>♡</span>Todavía no hay mensajes en tu bandejita.</div>';return}
    for(const msg of visible){const card=await createMessageCard(msg);list.appendChild(card);if(openIds.has(msg.id))card.open=true}
  }
  async function showTodayPopup(){
    const read=readSet(),hidden=hiddenSet(),msg=messages.find(m=>m.message_date===today()&&!read.has(m.id)&&!hidden.has(m.id));
    if(!msg||!popup.hidden||!panel.hidden)return;activeMessage=msg;const host=$('#dailyMessageContent');host.replaceChildren(await createMessageCard(msg,true));openLayer(popup);
  }
  function markRead(id){const read=readSet();read.add(id);saveSet('luz-inbox-read',read);updateBadge()}
  function hideMessage(id,card){
    if(!confirm('¿Quieres quitar este mensaje de tu bandeja?'))return false;
    const hidden=hiddenSet();hidden.add(id);saveSet('luz-inbox-hidden',hidden);card?.remove();updateBadge();
    renderInbox();return true;
  }
  async function loadInbox(){
    if(loading)return;loading=true;
    try{
      approved=await ensureDevice();$('#devicePairing').hidden=approved;
      if(!approved){messages=[];renderedSignature=null;updateBadge();if(!popup.hidden)closeLayer(popup);activeMessage=null;list.innerHTML='<div class="inbox-empty"><span>♡</span>Tu bandejita estará lista muy pronto. Puedes seguir disfrutando de toda la app.</div>';return}
      const {data,error}=await db.from('messages').select('*').lte('message_date',today()).order('message_date',{ascending:false});
      if(error)throw error;messages=data||[];updateBadge();await renderInbox();await showTodayPopup();
    }catch(err){renderedSignature=null;list.innerHTML='<div class="inbox-empty">No se ha podido conectar. Puedes seguir usando la app y volver a tocar el sobre para intentarlo de nuevo.</div>'}
    finally{loading=false}
  }

  $('#inboxButton').onclick=async()=>{list.querySelectorAll('details[open]').forEach(d=>d.open=false);openLayer(panel);await loadInbox()};
  $('#closeInbox').onclick=()=>closeLayer(panel);
  $('#inboxBackdrop').onclick=()=>closeLayer(panel);
  $('#closeDailyMessage').onclick=()=>{if(activeMessage)markRead(activeMessage.id);closeLayer(popup);activeMessage=null};
  $('#dailyPopupBackdrop').onclick=$('#closeDailyMessage').onclick;
  $('#deleteDailyMessage').onclick=()=>{if(!activeMessage)return;if(hideMessage(activeMessage.id)){closeLayer(popup);activeMessage=null}};
  document.addEventListener('keydown',e=>{
    const layer=!popup.hidden?popup:!panel.hidden?panel:null;if(!layer)return;
    if(e.key==='Escape'){e.preventDefault();(!popup.hidden?$('#closeDailyMessage'):$('#closeInbox')).click()}
    if(e.key==='Tab'){const items=[...layer.querySelectorAll('button:not(.layer-backdrop),summary,a[href]')].filter(x=>!x.hidden&&(!x.closest('details:not([open])')||x.tagName==='SUMMARY'));const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadInbox()});
  window.addEventListener('pageshow',()=>loadInbox());
  window.addEventListener('online',()=>loadInbox());
  setInterval(()=>{if(!document.hidden&&popup.hidden)loadInbox()},60000);
  loadInbox();
})();
