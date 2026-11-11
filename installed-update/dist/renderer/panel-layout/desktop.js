(() => {
  'use strict';
  const storageKey = 'mla-panel-layout-v1';
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const groups = new WeakMap(); let dragging = null, queued = false;
  const label = el => (el.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > .eyebrow, :scope > .panel-header h3')?.textContent || 'Panel').trim().slice(0, 70);
  const path = el => { const parts=[]; while(el && !el.matches('main')) { parts.unshift(el.tagName.toLowerCase()+'.'+[...el.classList].filter(c=>!c.startsWith('panel-layout') && c!=='movable-panel').join('.')+':'+[...el.parentElement?.children||[]].filter(n=>n.tagName===el.tagName).indexOf(el));el=el.parentElement; } return parts.join('/'); };
  function store() { try { localStorage.setItem(storageKey,JSON.stringify(saved)); } catch {} }
  function move(panel, target, after=false) {
    const parent=panel.parentElement, group=groups.get(parent); if(!group || target?.parentElement!==parent || panel===target) return;
    const children=[...parent.children].sort((a,b)=>Number(a.style.order)-Number(b.style.order));
    children.splice(children.indexOf(panel),1);children.splice(children.indexOf(target)+(after?1:0),0,panel);
    children.forEach((child,i)=>child.style.order=String(i)); saved[group.key]=children.map(child=>group.ids.get(child));store();
    document.querySelector('.panel-layout-status').textContent=label(panel)+' moved';
  }
  function step(panel,direction) {const peers=[...panel.parentElement.children].filter(el=>el.matches('.panel')).sort((a,b)=>Number(a.style.order)-Number(b.style.order));const i=peers.indexOf(panel);if(peers[i+direction])move(panel,peers[i+direction],direction>0);}
  function setup() {
    queued=false;
    for(const panel of document.querySelectorAll('main .panel')) {
      if(panel.closest('.modal-backdrop, .modal-card, [role="dialog"]'))continue;
      const parent=panel.parentElement;
      if([...parent.children].filter(el=>el.matches('.panel')).length<2)continue;
      let group=groups.get(parent);
      if(!group){group={key:path(parent),ids:new WeakMap()};groups.set(parent,group);const display=getComputedStyle(parent).display;if(!['grid','inline-grid','flex','inline-flex'].includes(display))parent.classList.add('panel-layout-column');}
      [...parent.children].forEach((child,index)=>{
        if(!group.ids.has(child)){const id=child.matches('.panel')?'panel:'+label(child):child.tagName+':'+index;group.ids.set(child,id);const rank=Array.isArray(saved[group.key])?saved[group.key].indexOf(id):-1;child.style.order=String(rank>=0?rank:index);}
      });
      if(panel.classList.contains('movable-panel'))continue;
      panel.classList.add('movable-panel');
      const toolbar=document.createElement('div');toolbar.className='panel-move-toolbar';toolbar.setAttribute('aria-label','Arrange '+label(panel));
      const grip=document.createElement('button');grip.type='button';grip.className='panel-drag-handle';grip.textContent='⠿ Drag panel';grip.setAttribute('aria-label','Move '+label(panel));grip.title='Drag this handle or the panel heading onto another panel. Arrow keys also move it.';
      grip.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();step(panel,event.key==='ArrowUp'?-1:1);}});

      const clearDrag=()=>{if(dragging?.frame)cancelAnimationFrame(dragging.frame);dragging=null;document.querySelectorAll('.panel-layout-target,.panel-layout-dragging').forEach(el=>el.classList.remove('panel-layout-target','panel-layout-dragging'));document.body.classList.remove('panel-layout-active');};
      const updateTarget=()=>{
        if(!dragging || dragging.panel!==panel || !dragging.moved)return;
        document.querySelectorAll('.panel-layout-target').forEach(el=>el.classList.remove('panel-layout-target'));
        let target=document.elementFromPoint(dragging.x,dragging.y)?.closest('.panel');
        while(target&&target.parentElement!==parent)target=target.parentElement?.closest('.panel');
        if(!target || target===panel){
          const peers=[...parent.children].filter(el=>el.matches('.movable-panel')&&el!==panel);
          let nearest=null,distance=Infinity;
          for(const peer of peers){const r=peer.getBoundingClientRect();const dx=Math.max(r.left-dragging.x,0,dragging.x-r.right),dy=Math.max(r.top-dragging.y,0,dragging.y-r.bottom);const d=Math.hypot(dx,dy);if(d<distance){distance=d;nearest=peer;}}
          target=distance<45?nearest:null;
        }
        dragging.target=target && target!==panel?target:null;
        dragging.target?.classList.add('panel-layout-target');
      };
      const scrollFrame=()=>{
        if(!dragging || dragging.panel!==panel || !dragging.moved)return;
        let container=panel.parentElement;
        while(container && !(container.scrollHeight>container.clientHeight+5 && /auto|scroll/.test(getComputedStyle(container).overflowY)))container=container.parentElement;
        container=container||document.scrollingElement;
        const rect=container===document.scrollingElement?{top:0,bottom:innerHeight}:container.getBoundingClientRect();
        if(dragging.y>rect.bottom-70)container.scrollTop+=14;else if(dragging.y<rect.top+70)container.scrollTop-=14;
        updateTarget();dragging.frame=requestAnimationFrame(scrollFrame);
      };
      panel.addEventListener('pointerdown',event=>{
        if(event.button!==0 || event.target.closest('.panel')!==panel)return;
        const isGrip=event.target.closest('.panel-drag-handle');
        if(!isGrip && (event.target.closest('button,input,select,textarea,a,label,video') || !(event.target.closest('h2,h3,h4,.eyebrow,.panel-header') || event.clientY-panel.getBoundingClientRect().top<44)))return;
        event.preventDefault();clearDrag();dragging={panel,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,target:null,moved:false,frame:null};panel.setPointerCapture(event.pointerId);
      });
      panel.addEventListener('pointermove',event=>{
        if(!dragging||dragging.panel!==panel)return;dragging.x=event.clientX;dragging.y=event.clientY;
        if(!dragging.moved && Math.hypot(event.clientX-dragging.startX,event.clientY-dragging.startY)<5)return;
        if(!dragging.moved){dragging.moved=true;panel.classList.add('panel-layout-dragging');document.body.classList.add('panel-layout-active');dragging.frame=requestAnimationFrame(scrollFrame);}updateTarget();
      });
      panel.addEventListener('pointerup',event=>{
        if(!dragging||dragging.panel!==panel)return;const d=dragging;
        if(d.moved && d.target){const peers=[...parent.children].sort((a,b)=>Number(a.style.order)-Number(b.style.order));move(panel,d.target,peers.indexOf(panel)<peers.indexOf(d.target));}
        clearDrag();if(panel.hasPointerCapture(event.pointerId))panel.releasePointerCapture(event.pointerId);
      });
      panel.addEventListener('pointercancel',clearDrag);panel.addEventListener('lostpointercapture',()=>{if(dragging?.panel===panel)clearDrag();});
      toolbar.append(grip);
      for(const [text,direction] of [['↑',-1],['↓',1]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.setAttribute('aria-label','Move '+label(panel)+(direction<0?' up':' down'));button.addEventListener('click',()=>step(panel,direction));toolbar.append(button);}panel.append(toolbar);
    }
  }
  function start(){const status=document.createElement('span');status.className='panel-layout-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');document.body.append(status);const reset=document.createElement('button');reset.type='button';reset.className='panel-layout-reset';reset.textContent='Reset panel layout';reset.addEventListener('click',()=>{saved={};store();document.querySelectorAll('main .panel-layout-column,main .movable-panel').forEach(el=>{const parent=el.matches('.movable-panel')?el.parentElement:el;[...parent.children].forEach((child,index)=>child.style.order=String(index));});status.textContent='Panel layout reset';});document.body.append(reset);const observer=new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(setup);}});observer.observe(document.getElementById('root'),{childList:true,subtree:true});setup();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
