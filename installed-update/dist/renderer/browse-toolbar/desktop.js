(() => {
  if(new URLSearchParams(location.search).has('playerWindow'))return;
  let main=null,bar=null,queued=false;const observed=new WeakSet();
  const selector='.library-page > .panel > .panel-header, .actresses-page > .panel > .panel-header';
  function set(element,key,value){if(element.style.getPropertyValue(key)!==value)element.style.setProperty(key,value);}
  function refresh(){queued=false;main=document.querySelector('main.content');if(!main)return;bar=main.querySelector(':scope > .topbar');if(bar&&!observed.has(bar)){observed.add(bar);resize.observe(bar);}const height=bar&&getComputedStyle(bar).display!=='none'?bar.getBoundingClientRect().height:0;set(main,'--browse-sticky-top',Math.ceil(height+8)+'px');let activeHeight=0;for(const header of main.querySelectorAll(selector)){header.classList.add('pinned-browse-toolbar');if(!observed.has(header)){observed.add(header);resize.observe(header);}if(header.getClientRects().length){activeHeight=header.getBoundingClientRect().height;const expected=main.getBoundingClientRect().top+height+8;header.classList.toggle('browse-toolbar-stuck',Math.abs(header.getBoundingClientRect().top-expected)<2);}}set(main,'--browse-toolbar-height',Math.ceil(activeHeight)+'px');}
  function queue(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
  const resize=new ResizeObserver(queue);
  function start(){new MutationObserver(queue).observe(document.getElementById('root'),{childList:true,subtree:true});document.addEventListener('scroll',event=>{if(event.target===main)queue();},true);window.addEventListener('resize',queue);queue();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
