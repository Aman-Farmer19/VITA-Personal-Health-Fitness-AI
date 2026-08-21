export type VitaActivity = 'IDLE' | 'WALKING' | 'RUNNING';

export interface VitaState {
    steps: number;
    cadence: number;
    activity: VitaActivity;
    distance: number;
    calories: number;

    mood: string;
    expression: string;

    heartRate: number | null;

    micOn: boolean;
    camOn: boolean;
    stepsOn: boolean;
    phoneLinked: boolean;

    timestamp: string;
}

export const createEmptyVitaState = (): VitaState => ({
    steps: 0,
    cadence: 0,
    activity: 'IDLE',
    distance: 0,
    calories: 0,

    mood: 'CALM',
    expression: '',

    heartRate: null,

    micOn: false,
    camOn: false,
    stepsOn: false,
    phoneLinked: false,

    timestamp: new Date().toISOString(),
});