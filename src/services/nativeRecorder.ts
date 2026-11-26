import {requireNativeModule} from 'expo-modules-core';

export type NativeSegment = {
 index: number;
 path?: string;
 startedAtMs: number;
 endedAtMs: number;
 offsetMs?: number;
};

export type RecorderState = {
 sessionId: string;
 startedAt: number;
 segmentSeconds: number;
 status: 'starting' | 'recording' | 'recorded' | 'interrupted';
 active: boolean;
 segments: string;
 error?: string;
};

const NativeRecorder = requireNativeModule<{
 start(sessionId: string, segmentSeconds: number): Promise<void>;
 stop(sessionId: string): Promise<void>;
 getState(): Promise<RecorderState | null>;
 recover(): Promise<RecorderState[]>;
}>('NotulenKuRecorder');

export const nativeRecorder = {
 start: (sessionId: string, segmentSeconds = 180) => NativeRecorder.start(sessionId, segmentSeconds),
 stop: (sessionId: string) => NativeRecorder.stop(sessionId),
 getState: () => NativeRecorder.getState(),
 recover: () => NativeRecorder.recover(),
};
