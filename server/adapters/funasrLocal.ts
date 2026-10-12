import type {AIProvider,Capability} from '../types';
import {allowedLocalSttModels, assertLocalSttAllowed} from '../services/localSttPolicy';
import {assertExpectedTranscript,capabilityTestSpeech} from './capabilityTestMedia';
import {ProviderError} from './errors';
import {FUNASR_MODELS,funAsrRuntimeStatus,transcribeWithFunAsr} from '../services/funAsr';

export async function listModels(_provider:AIProvider){
  return allowedLocalSttModels(FUNASR_MODELS);
}

export async function testConnection(_provider:AIProvider){
  const status=await funAsrRuntimeStatus();
  return {
    ok:true,
    warning:`FunASR Local runtime đã sẵn sàng · ${status.device==='auto'?'tự chọn CPU/GPU':status.device} · CPU tối đa ${status.threads} luồng · model/cache không đi kèm source clone; bấm Test model để tải và kiểm tra inference thật.`,
  };
}

export async function testModel(provider:AIProvider,model:string,capability:Capability){
  assertLocalSttAllowed(model);
  if(capability!=='stt')throw new ProviderError('FunASR Local chỉ hỗ trợ capability STT.',400);
  const startedAt=Date.now();
  const result=await transcribe(provider,model,capabilityTestSpeech(),'autosub-test.ogg','en');
  assertExpectedTranscript(result.text);
  return {ok:true,model,capability:'stt',latencyMs:Date.now()-startedAt,output:result.text.slice(0,120)};
}

export function transcribe(_provider:AIProvider,model:string,audio:Buffer|string,filename:string,language:string,signal?:AbortSignal,onProgress?:(percent:number)=>void){
  assertLocalSttAllowed(model);
  return transcribeWithFunAsr(model,audio,filename,language,signal,onProgress);
}
