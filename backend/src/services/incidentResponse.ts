/**
 * Formal Incident Response Plan (IRP)
 *
 * Implements HIPAA §164.308(a)(6) — Security Incident Procedures
 * and §164.308(a)(7) — Contingency Plan requirements.
 *
 * Structured incident lifecycle:
 * - Incident declaration and classification
 * - Escalation procedures and contact management
 * - Response phase tracking (detect → contain → eradicate → recover → lessons learned)
 * - Timeline logging with actor attribution
 * - Post-incident review and action items
 *
 * Ported from assemblyai_tool/server/services/incident-response.ts.
 */

import { logger } from '../utils/logger';

// --- Types ---

export type IncidentSeverity = 'P1-critical' | 'P2-high' | 'P3-medium' | 'P4-low';

export type IncidentPhase =
  | 'detection' | 'triage' | 'containment' | 'eradication'
  | 'recovery' | 'post-incident' | 'closed';

export type IncidentCategory =
  | 'data_breach' | 'unauthorized_access' | 'malware' | 'denial_of_service'
  | 'insider_threat' | 'system_compromise' | 'data_loss' | 'policy_violation'
  | 'phishing' | 'other';

export interface EscalationContact {
  name: string;
  role: string;
  email?: string;
  phone?: string;
  notifyAt: IncidentSeverity[];
}

export interface TimelineEntry {
  timestamp: string;
  phase: IncidentPhase;
  action: string;
  actor: string;
  automated: boolean;
}

export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  dueDate?: string;
  status: 'open' | 'in_progress' | 'completed';
  completedAt?: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  currentPhase: IncidentPhase;
  declaredAt: string;
  declaredBy: string;
  updatedAt: string;
  closedAt?: string;
  affectedSystems: string[];
  affectedUsers: number;
  containmentActions: string[];
  eradicationActions: string[];
  recoveryActions: string[];
  lessonsLearned?: string;
  timeline: TimelineEntry[];
  actionItems: ActionItem[];
  phiInvolved: boolean;
}

// --- In-Memory Store (capped) ---
const MAX_INCIDENTS = 500;
const incidents: Incident[] = [];

// --- Escalation Contacts ---
const escalationContacts: EscalationContact[] = [
  { name: 'System Administrator', role: 'IT Admin / Incident Commander', notifyAt: ['P1-critical', 'P2-high', 'P3-medium', 'P4-low'] },
  { name: 'HIPAA Privacy Officer', role: 'Compliance', notifyAt: ['P1-critical', 'P2-high'] },
  { name: 'Management', role: 'Executive Sponsor', notifyAt: ['P1-critical'] },
];

// --- Response Procedures ---

export interface ResponseProcedure {
  phase: IncidentPhase;
  title: string;
  steps: string[];
  timeTarget: string;
}

export const RESPONSE_PROCEDURES: ResponseProcedure[] = [
  {
    phase: 'detection', title: 'Detection & Identification',
    steps: [
      'Verify the alert is a real incident (not a false positive)',
      'Identify affected systems, data types, and scope',
      'Determine if PHI is potentially involved',
      'Classify severity (P1-P4) based on impact and urgency',
      'Declare the incident and assign an incident commander',
    ],
    timeTarget: 'Within 1 hour of alert',
  },
  {
    phase: 'triage', title: 'Triage & Escalation',
    steps: [
      'Notify escalation contacts based on severity level',
      'If PHI is involved, notify HIPAA Privacy Officer immediately',
      'Document initial findings in the incident timeline',
      'Assign initial response team members',
      'Establish communication channel for incident updates',
    ],
    timeTarget: 'Within 2 hours of detection',
  },
  {
    phase: 'containment', title: 'Containment',
    steps: [
      'Isolate affected systems to prevent further damage',
      'Block suspicious IP addresses or user accounts',
      'Preserve evidence (logs, screenshots, affected data snapshots)',
      'Implement temporary controls (additional monitoring, restricted access)',
      'Verify containment is effective',
    ],
    timeTarget: 'Within 4 hours for P1/P2, 24 hours for P3/P4',
  },
  {
    phase: 'eradication', title: 'Eradication',
    steps: [
      'Identify root cause of the incident',
      'Remove malware, unauthorized access, or vulnerability',
      'Patch affected systems and update configurations',
      'Reset compromised credentials',
      'Verify eradication with security scan',
    ],
    timeTarget: 'Within 24 hours for P1, 72 hours for P2/P3',
  },
  {
    phase: 'recovery', title: 'Recovery',
    steps: [
      'Restore affected systems from clean backups if needed',
      'Verify system integrity before returning to production',
      'Monitor closely for recurrence',
      'Gradually restore normal operations',
      'Confirm with stakeholders that systems are operational',
    ],
    timeTarget: 'Within 48 hours for P1, 1 week for P2/P3',
  },
  {
    phase: 'post-incident', title: 'Post-Incident Review',
    steps: [
      'Conduct post-incident review meeting within 5 business days',
      'Document root cause analysis and contributing factors',
      'Identify process improvements and preventive measures',
      'Create action items with owners and due dates',
      'Update incident response plan based on lessons learned',
      'If PHI breach confirmed, follow HIPAA breach notification timeline (60 days)',
    ],
    timeTarget: 'Within 5 business days of recovery',
  },
];

// --- Incident Management ---

export function declareIncident(params: {
  title: string;
  description: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  declaredBy: string;
  affectedSystems?: string[];
  phiInvolved?: boolean;
}): Incident {
  const now = new Date().toISOString();
  const incident: Incident = {
    id: `INC-${Date.now()}`,
    title: params.title,
    description: params.description,
    severity: params.severity,
    category: params.category,
    currentPhase: 'detection',
    declaredAt: now,
    declaredBy: params.declaredBy,
    updatedAt: now,
    affectedSystems: params.affectedSystems || [],
    affectedUsers: 0,
    containmentActions: [],
    eradicationActions: [],
    recoveryActions: [],
    timeline: [{
      timestamp: now, phase: 'detection',
      action: `Incident declared: ${params.title}`,
      actor: params.declaredBy, automated: false,
    }],
    actionItems: [],
    phiInvolved: params.phiInvolved || false,
  };

  incidents.push(incident);

  // Evict oldest closed incidents if at capacity
  if (incidents.length > MAX_INCIDENTS) {
    const closedIdx = incidents.findIndex(i => i.currentPhase === 'closed');
    if (closedIdx >= 0) incidents.splice(closedIdx, 1);
    else incidents.shift();
  }

  logger.error('INCIDENT declared', {
    id: incident.id, severity: params.severity,
    title: params.title, phiInvolved: params.phiInvolved,
  });

  return incident;
}

export function advanceIncidentPhase(
  incidentId: string, newPhase: IncidentPhase, action: string, actor: string,
): Incident | null {
  const incident = incidents.find(i => i.id === incidentId);
  if (!incident) return null;

  const now = new Date().toISOString();
  incident.currentPhase = newPhase;
  incident.updatedAt = now;
  if (newPhase === 'closed') incident.closedAt = now;

  incident.timeline.push({ timestamp: now, phase: newPhase, action, actor, automated: false });

  logger.info('Incident phase advanced', { id: incidentId, phase: newPhase, actor });
  return incident;
}

export function addTimelineEntry(
  incidentId: string, action: string, actor: string, automated = false,
): Incident | null {
  const incident = incidents.find(i => i.id === incidentId);
  if (!incident) return null;

  incident.updatedAt = new Date().toISOString();
  incident.timeline.push({
    timestamp: incident.updatedAt, phase: incident.currentPhase, action, actor, automated,
  });
  return incident;
}

export function addActionItem(
  incidentId: string, description: string, assignee: string, dueDate?: string,
): Incident | null {
  const incident = incidents.find(i => i.id === incidentId);
  if (!incident) return null;

  incident.actionItems.push({
    id: `AI-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description, assignee, dueDate, status: 'open',
  });
  incident.updatedAt = new Date().toISOString();
  return incident;
}

export function updateActionItem(
  incidentId: string, actionItemId: string, status: ActionItem['status'],
): Incident | null {
  const incident = incidents.find(i => i.id === incidentId);
  if (!incident) return null;

  const item = incident.actionItems.find(ai => ai.id === actionItemId);
  if (!item) return null;

  item.status = status;
  if (status === 'completed') item.completedAt = new Date().toISOString();
  incident.updatedAt = new Date().toISOString();
  return incident;
}

export function updateIncidentDetails(
  incidentId: string,
  updates: Partial<Pick<Incident, 'containmentActions' | 'eradicationActions' | 'recoveryActions' | 'lessonsLearned' | 'affectedUsers' | 'severity'>>,
  actor: string,
): Incident | null {
  const incident = incidents.find(i => i.id === incidentId);
  if (!incident) return null;

  const now = new Date().toISOString();
  Object.assign(incident, updates);
  incident.updatedAt = now;

  incident.timeline.push({
    timestamp: now, phase: incident.currentPhase,
    action: `Updated: ${Object.keys(updates).join(', ')}`,
    actor, automated: false,
  });
  return incident;
}

// --- Query Functions ---

export function getAllIncidents(): Incident[] {
  return [...incidents].reverse();
}

export function getIncident(id: string): Incident | null {
  return incidents.find(i => i.id === id) || null;
}

export function getEscalationContacts(): EscalationContact[] {
  return [...escalationContacts];
}

export function getResponseProcedures(): ResponseProcedure[] {
  return RESPONSE_PROCEDURES;
}
