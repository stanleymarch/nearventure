import type { TripIntent } from './contracts';

/** The short, non-wizard planning flow shared by web and Mini App clients.
 * UI owns field values; this reducer owns only the navigable step. */
export const plannerStages = ['intent', 'conditions', 'preferences', 'review'] as const;
export type PlannerStage = (typeof plannerStages)[number];

export interface PlannerFlowState {
  stage: PlannerStage;
  /** A deep link or POI action can prefill intent and skip the choice screen. */
  intent?: TripIntent;
  intentPrefilled: boolean;
}

export type PlannerFlowEvent =
  | { type: 'choose_intent'; intent: TripIntent }
  | { type: 'continue' }
  | { type: 'back' }
  | { type: 'go_to'; stage: PlannerStage }
  | { type: 'reset'; intent?: TripIntent };

export function createPlannerFlow(intent?: TripIntent): PlannerFlowState {
  return { stage: intent ? 'conditions' : 'intent', intent, intentPrefilled: Boolean(intent) };
}

export function plannerFlowReducer(state: PlannerFlowState, event: PlannerFlowEvent): PlannerFlowState {
  switch (event.type) {
    case 'choose_intent': return { stage: 'conditions', intent: event.intent, intentPrefilled: false };
    case 'continue': return { ...state, stage: nextStage(state.stage) };
    case 'back': return { ...state, stage: previousStage(state.stage, state.intentPrefilled) };
    case 'go_to': return { ...state, stage: event.stage };
    case 'reset': return createPlannerFlow(event.intent);
  }
}

export function nextStage(stage: PlannerStage): PlannerStage {
  return plannerStages[Math.min(plannerStages.indexOf(stage) + 1, plannerStages.length - 1)];
}

/** If intent was supplied by entry context, Back from conditions should not show
 * an artificial choice the user did not make in this session. */
export function previousStage(stage: PlannerStage, intentPrefilled = false): PlannerStage {
  if (stage === 'conditions' && intentPrefilled) return 'conditions';
  return plannerStages[Math.max(plannerStages.indexOf(stage) - 1, 0)];
}

export function canBuildFrom(stage: PlannerStage): boolean {
  return stage === 'review';
}
