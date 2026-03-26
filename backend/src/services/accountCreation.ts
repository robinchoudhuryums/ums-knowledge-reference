/**
 * PMD Account Creation Questionnaire
 *
 * Form used by PMD Sales reps to collect patient information and determine
 * if a PMD order can be initiated based on insurance, location, and condition.
 * Results are submitted to the queue or emailed to the sales team.
 */

export interface AccountCreationQuestion {
  id: string;
  number: string;
  text: string;
  spanishText: string;
  type: 'text' | 'checkbox' | 'textarea';
  group: string;
  required: boolean;
  isSecondary?: boolean;  // Indented/italic sub-question
}

export interface AccountCreationResponse {
  questionId: string;
  answer: string | boolean | null;
}

const AC_QUESTIONS: AccountCreationQuestion[] = [
  // Demographics
  { id: 'ac1', number: '1', text: 'Patient Full Name', spanishText: 'Nombre Completo del Paciente', type: 'text', group: 'Demographics', required: true },
  { id: 'ac2', number: '2', text: 'Patient Primary Contact Phone #', spanishText: 'Número de Teléfono de Contacto Primario', type: 'text', group: 'Demographics', required: true },
  { id: 'ac3', number: '3', text: 'Secondary Contact Ph#', spanishText: 'Número de Teléfono de Contacto Secundario', type: 'text', group: 'Demographics', required: false, isSecondary: true },
  { id: 'ac4', number: '4', text: 'Patient Email Address', spanishText: 'Correo Electrónico del Paciente', type: 'text', group: 'Demographics', required: false },
  { id: 'ac5', number: '5', text: 'DOB', spanishText: 'Fecha de Nacimiento (DOB)', type: 'text', group: 'Demographics', required: true },
  { id: 'ac6', number: '6', text: 'Home Address', spanishText: 'Dirección de Casa', type: 'text', group: 'Demographics', required: true },

  // Insurance
  { id: 'ac7', number: '7', text: 'Primary Insurance & Member ID#', spanishText: 'Seguro Primario y Número de ID de Miembro', type: 'text', group: 'Insurance', required: true },
  { id: 'ac8', number: '8', text: 'Secondary Insurance & Member ID#', spanishText: 'Seguro Secundario y Número de ID de Miembro', type: 'text', group: 'Insurance', required: false, isSecondary: true },
  { id: 'ac9', number: '9', text: 'SSN # (if insurance details N/A)', spanishText: 'Número de Seguro Social (SSN) (si no hay detalles de seguro)', type: 'text', group: 'Insurance', required: false },

  // Clinical Information
  { id: 'ac10', number: '10', text: 'PCP Name', spanishText: 'Nombre del Doctor Primario (PCP)', type: 'text', group: 'Clinical Information', required: true },
  { id: 'ac11', number: '11', text: 'MDO Ph#', spanishText: 'Teléfono de clínica', type: 'text', group: 'Clinical Information', required: false },
  { id: 'ac12', number: '12', text: 'MDO Fax#', spanishText: 'Fax de clínica', type: 'text', group: 'Clinical Information', required: false },
  { id: 'ac13', number: '13', text: 'Height', spanishText: 'Estatura', type: 'text', group: 'Clinical Information', required: true },
  { id: 'ac14', number: '14', text: 'Weight (lbs)', spanishText: 'Peso (libras)', type: 'text', group: 'Clinical Information', required: true },
  { id: 'ac15', number: '15', text: 'Currently used mobility devices', spanishText: 'Dispositivos de movilidad que utilizas', type: 'text', group: 'Clinical Information', required: true },
  { id: 'ac16', number: '16', text: 'Diagnoses', spanishText: 'Diagnósticos', type: 'textarea', group: 'Clinical Information', required: true, isSecondary: true },
  { id: 'ac17', number: '17', text: 'Currently staying at Home or Facility?', spanishText: '¿Está en casa o en un centro médico?', type: 'text', group: 'Clinical Information', required: true },
  { id: 'ac18', number: '18', text: 'If in facility what is the approximate discharge date?', spanishText: 'Si está en un centro, ¿cuál es la fecha aproximada de salida?', type: 'text', group: 'Clinical Information', required: false, isSecondary: true },

  // Mobility Evaluation & Scheduling
  { id: 'ac19', number: '19', text: 'Already had a Power Mobility Evaluation in last 6 months?', spanishText: '¿Ya tuvo una Evaluación de Movilidad en los últimos 6 meses?', type: 'checkbox', group: 'Mobility Evaluation & Scheduling', required: false },
  { id: 'ac20', number: '20', text: 'If so please provide appointment details', spanishText: 'Si es así, por favor proporcione los detalles de la cita', type: 'text', group: 'Mobility Evaluation & Scheduling', required: false, isSecondary: true },
  { id: 'ac21', number: '21', text: 'Explained mobility evaluation with doctor is needed for insurance purposes and that we will send MDO paperwork to be filled out during the appointment to be sent back to us', spanishText: 'Explicó que la evaluación de movilidad con el médico es necesaria según el seguro, y que le enviaremos al médico la documentación para que la finalice durante la cita y nos la devuelva.', type: 'checkbox', group: 'Mobility Evaluation & Scheduling', required: true },
  { id: 'ac22', number: '22', text: 'Permission to call & schedule Mobility Evaluation with MDO?', spanishText: '¿Tenemos permiso para programar una cita con su médico?', type: 'checkbox', group: 'Mobility Evaluation & Scheduling', required: true },
  { id: 'ac23', number: '23', text: 'ME Availability', spanishText: 'Disponibilidad para Evaluación de Movilidad (ME)', type: 'text', group: 'Mobility Evaluation & Scheduling', required: false, isSecondary: true },
  { id: 'ac24', number: '24', text: 'PPD Availability', spanishText: 'Disponibilidad para PPD', type: 'text', group: 'Mobility Evaluation & Scheduling', required: false, isSecondary: true },
  { id: 'ac25', number: '25', text: 'Other Notes', spanishText: 'Otras Notas', type: 'textarea', group: 'Mobility Evaluation & Scheduling', required: false },
];

const AC_GROUPS = [
  'Demographics',
  'Insurance',
  'Clinical Information',
  'Mobility Evaluation & Scheduling',
];

export function getAccountCreationQuestions(): AccountCreationQuestion[] {
  return AC_QUESTIONS;
}

export function getAccountCreationGroups(): string[] {
  return AC_GROUPS;
}
