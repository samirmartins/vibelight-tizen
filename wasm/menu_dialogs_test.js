'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
async function run(){
 let view={},current=view,pops=0,cancels=0,focused=0;const modal={};
 const opener={id:'origin',isConnected:true,getClientRects:()=>[{}],focus(){focused++;}};
 view.view={index:0,func:()=>({0:opener,length:1})};
 const dialog={open:true,close(){if(!this.open)throw Error('polyfill already closed');this.open=false;if(this.onclose)this.onclose();}};
 const button={click(){cancels++;dialog.close();c.isDialogOpen=false;current=view;pops++;}};
 const c={Promise,isDialogOpen:true,isInGame:false,document:{hidden:false,activeElement:opener,getElementById:()=>button},Navigation:{current:()=>current,isCurrent:v=>v===current}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('wasm/platform/menu-dialogs.js','utf8'),c);
 function open(){current=view;c.isDialogOpen=true;dialog.open=true;c.MenuDialogs.prepare(dialog,'cancel',modal);current=modal;}
 open();let prevented=0;dialog.oncancel({preventDefault(){prevented++;}});await Promise.resolve();
 assert.equal(prevented,1);assert.equal(cancels,1);assert.equal(pops,1);assert.equal(focused,1);
 dialog.onclose();await Promise.resolve();assert.equal(focused,1,'a delayed native close event cannot steal focus again');
 open();dialog.close();await Promise.resolve();assert.equal(cancels,2,'external close uses the cancellation owner');assert.equal(pops,2);
 open();dialog.close();open();await Promise.resolve();assert.equal(cancels,2,'a stale close cannot cancel a reopened dialog');
 button.click();await Promise.resolve();assert.equal(pops,3,'button cleanup runs once');
 open();dialog.close();current={};await Promise.resolve();assert.equal(pops,3,'a different current dialog is preserved');
 const first={id:'other'};view.view={index:0,func:()=>({0:first,1:opener,length:2}),current:()=>first};
 c.Views={Apps:view};c.document.querySelector=()=>opener;c.document.activeElement={};
 open();assert.equal(view.view.index,1,'library fallback follows the selected card, not an unused ListView index');
 button.click();await Promise.resolve();
 console.log('menu_dialogs_test: Escape, external/polyfill close, one cleanup, focus and reopened/new-view guards PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
