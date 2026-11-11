(() => {
  if(new URLSearchParams(location.search).has('playerWindow'))document.documentElement.classList.add('detached-player');
  const positions = new Map(); let route = null, restoring = false, frame = 0;
  const currentRoute = () => document.querySelector('.sidebar .nav-link.active')?.textContent.trim() || null;
  const read = () => ({main:document.querySelector('main.content')?.scrollTop || 0, document:document.scrollingElement?.scrollTop || 0});
  const restore = () => {const saved=positions.get(route)||{main:0,document:0};const main=document.querySelector('main.content');if(main)main.scrollTop=saved.main;if(document.scrollingElement)document.scrollingElement.scrollTop=saved.document;};
  function check(){const next=currentRoute();if(!next||next===route)return;route=next;restoring=true;cancelAnimationFrame(frame);restore();frame=requestAnimationFrame(()=>{restore();frame=requestAnimationFrame(()=>{restore();restoring=false;});});}
  document.addEventListener('scroll',event=>{if(restoring||!route||currentRoute()!==route)return;if(event.target===document||event.target===document.scrollingElement||event.target===document.querySelector('main.content'))positions.set(route,read());},true);
  function start(){new MutationObserver(check).observe(document.getElementById('root'),{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});check();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
