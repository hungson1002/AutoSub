import type {AIProvider,Capability} from '../types';
import {allowedLocalSttModels, assertLocalSttAllowed} from '../services/localSttPolicy';
import {assertExpectedTranscript,capabilityTestSpeech} from './capabilityTestMedia';
import {ProviderError} from './errors';
import {QWEN3_ASR_MODELS,qwen3AsrRuntimeStatus,transcribeWithQwen3Asr} from '../services/qwen3Asr';

export async function listModels(_provider:AIProvider){
  return allowedLocalSttModels(QWEN3_ASR_MODELS);
}

export async function testConnection(_provider:AIProvider){
  const status=await qwen3AsrRuntimeStatus();
  return {
    ok:true,
    warning:`Qwen3-ASR Local runtime đã sẵn sàng · ${status.device==='auto'?'CPU mặc định / custom CUDA env nếu cấu hình':status.device} · ${status.threads} CPU threads · model + ForcedAligner/cache không đi kèm source clone; bấm Test model để tải và kiểm tra inference thật.`,
  };
}

export async function testModel(provider:AIProvider,model:string,capability:Capability){
  assertLocalSttAllowed(model);
  if(capability!=='stt')throw new ProviderError('Qwen3-ASR Local chỉ hỗ trợ capability STT.',400);
  const startedAt=Date.now();
  const result=await transcribeWithQwen3Asr(model,capabilityTestSpeech(),'autosub-test.ogg','en');
  assertExpectedTranscript(result.text);
  if(!result.segments.some(segment=>Array.isArray(segment.words)&&segment.words.length>0)){
    throw new ProviderError('Qwen3 ForcedAligner không trả word/character timestamp.',502);
  }
  return {ok:true,model,capability:'stt',latencyMs:Date.now()-startedAt,output:result.text.slice(0,120)};
}

export function transcribe(_provider:AIProvider,model:string,audio:Buffer|string,filename:string,language:string,signal?:AbortSignal,onProgress?:(percent:number)=>void){
  assertLocalSttAllowed(model);
  return transcribeWithQwen3Asr(model,audio,filename,language,signal,onProgress);
}
