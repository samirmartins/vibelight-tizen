'use strict';
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const source=fs.readFileSync('libgamestream/http.c','utf8');
const create=source.slice(source.indexOf('PHTTP_DATA http_create_data()'),source.indexOf('void http_free_data('));
const reset=source.slice(source.indexOf('  if (data->size > 0) {'),source.indexOf('\n  CURLcode res ='));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'http-empty-response-'));
try{
 const file=path.join(dir,'test.c'),bin=path.join(dir,'test');
 fs.writeFileSync(file,`
#include <assert.h>
#include <string.h>
#include <stdlib.h>
#include "http.h"
#include "errors.h"
static void* dirty_malloc(size_t n){void* p=malloc(n);if(p)memset(p,0xab,n);return p;}
#define malloc dirty_malloc
${create}
static int reset_response(PHTTP_DATA data){int ret=GS_OK;${reset}cleanup:return ret;}
int main(){
 PHTTP_DATA data=http_create_data();assert(data && data->memory[0]==0 && data->size==0);
 free(data->memory);data->memory=malloc(5);memcpy(data->memory,"old",4);data->size=3;
 assert(reset_response(data)==GS_OK && data->size==0 && data->memory[0]==0);
 assert(reset_response(data)==GS_OK && data->memory[0]==0);
 free(data->memory);free(data);
}
`);
 cp.execFileSync('gcc',['-std=c11','-O1','-g','-fsanitize='+(process.env.ML_NATIVE_SANITIZERS||'address,undefined'),'-Ilibgamestream',file,'-o',bin],{stdio:'inherit'});
 cp.execFileSync(bin,[],{stdio:'inherit'});
 console.log('http_empty_response_test: production create/reset terminate empty bodies even with dirty allocations OK');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
