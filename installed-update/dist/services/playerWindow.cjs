'use strict';
function createPlayerWindow({app,BrowserWindow,ipcMain,path,database,getMainWindow,isGentleUnlocked,sendMovie}) {
  let player=null,currentId=null;
  const resolveMovie=()=>{if(!currentId)return null;const movie=database.getMovie(currentId);if(!movie || (movie.libraryMode==='gentle'&&!isGentleUnlocked()))return null;return movie;};
  const allowed=event=>event.sender===getMainWindow()?.webContents||event.sender===player?.webContents;
  async function open(event,id){
    if(!allowed(event))throw Error('Untrusted player request.');
    if(id!==null&&id!==undefined&&(typeof id!=='string'||id.length>512))throw Error('Invalid movie.');
    if(id){const movie=database.getMovie(id);if(!movie||(movie.libraryMode==='gentle'&&!isGentleUnlocked()))throw Error('Movie unavailable or locked.');currentId=id;}
    if(player&&!player.isDestroyed()){if(player.isMinimized())player.restore();player.show();player.focus();sendMovie(player,resolveMovie());return {ok:true};}
    player=new BrowserWindow({width:1180,height:780,minWidth:700,minHeight:460,title:'MLA+ Player',backgroundColor:'#0f1217',autoHideMenuBar:true,webPreferences:{preload:path.join(app.getAppPath(),'dist/main/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    player.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    player.webContents.on('will-navigate',event=>event.preventDefault());
    const main=getMainWindow();const close=()=>{if(player&&!player.isDestroyed())player.close();};main?.once('closed',close);
    const timer=setInterval(()=>{if(currentId&&!resolveMovie())close();},1000);timer.unref();
    player.on('closed',()=>{clearInterval(timer);main?.removeListener('closed',close);player=null;currentId=null;});
    const openedWindow=player;let windowClosing=false;openedWindow.on("close",()=>{windowClosing=true;});
    const url=process.env.ELECTRON_RENDERER_URL;
    try {
    if(url){const target=new URL(url);target.searchParams.set('playerWindow','1');await player.loadURL(target.toString());}
    else await player.loadFile(path.join(app.getAppPath(),'dist/renderer/index.html'),{query:{playerWindow:'1'}});
    } catch(error) { if(windowClosing||openedWindow.isDestroyed()||[-2,-3].includes(error.errno))return {ok:false};throw error; }
    if(player&&!player.isDestroyed()){player.show();player.focus();}return {ok:true};
  }
  function getMovie(event){if(event.sender!==player?.webContents)throw Error('Player window only.');return resolveMovie();}
  return {open,getMovie,getWindow:()=>player};
}
module.exports={createPlayerWindow};
