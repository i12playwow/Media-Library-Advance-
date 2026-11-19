'use strict';
function createPlayerWindow({app,BrowserWindow,ipcMain,path,database,getMainWindow,isGentleUnlocked,sendMovie}) {
  let player=null,currentId=null,frameless=false,createEpoch=0;
  const resolveMovie=()=>{if(!currentId)return null;const movie=database.getMovie(currentId);if(!movie || (movie.libraryMode==='gentle'&&!isGentleUnlocked()))return null;return movie;};
  const allowed=event=>event.sender===getMainWindow()?.webContents||event.sender===player?.webContents;
  async function createWindow(){
    const epoch=++createEpoch;
    const nextPlayer=new BrowserWindow({width:1180,height:780,minWidth:700,minHeight:460,title:'MLA+ Player',backgroundColor:'#0f1217',autoHideMenuBar:true,frame:!frameless,webPreferences:{preload:path.join(app.getAppPath(),'dist/main/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    player=nextPlayer;
    nextPlayer.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    nextPlayer.webContents.on('will-navigate',event=>event.preventDefault());
    const main=getMainWindow();const close=()=>{if(!nextPlayer.isDestroyed())nextPlayer.close();};main?.once('closed',close);
    const timer=setInterval(()=>{if(currentId&&!resolveMovie()&&!nextPlayer.isDestroyed())nextPlayer.close();},1000);timer.unref();
    nextPlayer.on('closed',()=>{clearInterval(timer);main?.removeListener('closed',close);if(player===nextPlayer){player=null;if(epoch===createEpoch)currentId=null;}});
    const url=process.env.ELECTRON_RENDERER_URL;
    try {
      if(url){const target=new URL(url);target.searchParams.set('playerWindow','1');if(frameless)target.searchParams.set('frameless','1');else target.searchParams.delete('frameless');await nextPlayer.loadURL(target.toString());}
      else await nextPlayer.loadFile(path.join(app.getAppPath(),'dist/renderer/index.html'),{query:frameless?{playerWindow:'1',frameless:'1'}:{playerWindow:'1'}});
    } catch(error) { if(nextPlayer.isDestroyed()||[-2,-3].includes(error.errno))return {ok:false};throw error; }
    if(epoch!==createEpoch||nextPlayer.isDestroyed())return {ok:false};
    nextPlayer.show();nextPlayer.focus();
    sendMovie(nextPlayer,resolveMovie());
    return {ok:true};
  }
  async function open(event,id){
    if(!allowed(event))throw Error('Untrusted player request.');
    if(id!==null&&id!==undefined&&(typeof id!=='string'||id.length>512))throw Error('Invalid movie.');
    if(id){const movie=database.getMovie(id);if(!movie||(movie.libraryMode==='gentle'&&!isGentleUnlocked()))throw Error('Movie unavailable or locked.');currentId=id;}
    if(player&&!player.isDestroyed()){if(player.isMinimized())player.restore();player.show();player.focus();sendMovie(player,resolveMovie());return {ok:true};}
    return createWindow();
  }
  function getMovie(event){if(event.sender!==player?.webContents)throw Error('Player window only.');return resolveMovie();}
  async function setFrameless(event,value){
    if(event.sender!==player?.webContents)throw Error('Player window only.');
    frameless=Boolean(value);
    const previous=player;
    if(previous&&!previous.isDestroyed())previous.destroy();
    player=null;
    return createWindow();
  }
  function windowAction(event,action){
    if(event.sender!==player?.webContents)throw Error('Player window only.');
    if(!player||player.isDestroyed())return {ok:false,maximized:false};
    if(action==='minimize')player.minimize();
    else if(action==='maximize')player.isMaximized()?player.unmaximize():player.maximize();
    else if(action==='close')player.close();
    else throw Error('Invalid player window action.');
    return {ok:true,maximized:!player.isDestroyed()&&player.isMaximized()};
  }
  return {open,getMovie,setFrameless,windowAction,getWindow:()=>player};
}
module.exports={createPlayerWindow};
