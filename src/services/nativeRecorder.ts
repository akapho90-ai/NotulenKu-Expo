import {requireNativeModule} from 'expo-modules-core';
const NativeRecorder=requireNativeModule('NotulenKuRecorder');
export const nativeRecorder={start:(sessionId:string,segmentSeconds=180)=>NativeRecorder.start(sessionId,segmentSeconds),stop:()=>NativeRecorder.stop(),getState:()=>NativeRecorder.getState()};
