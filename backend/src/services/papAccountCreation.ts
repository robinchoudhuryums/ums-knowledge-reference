/**
 * PAP (Positive Airway Pressure) Account Creation Questionnaire
 *
 * Form used by CPAP/BiPAP sales reps to collect patient information
 * for PAP equipment orders. Covers demographics, insurance, clinical info,
 * and PAP-specific details (sleep study, current equipment, mask type).
 */

/** Increment when questions or schema change, for audit traceability. */
export const PAP_FORM_VERSION = '1.0';

export interface PapQuestion {
  id: string;
  number: string;
  text: string;
  spanishText: string;
  type: 'text' | 'checkbox' | 'textarea' | 'select';
  group: string;
  required: boolean;
  isSecondary?: boolean;
  options?: string[];
  conditionalFormatting?: Record<string, { bgColor: string; textColor: string }>;
}

export interface PapResponse {
  questionId: string;
  answer: string | boolean | null;
}

const PAP_QUESTIONS: PapQuestion[] = [
  // Demographics
  { id: 'pap1', number: '1', text: 'Patient Full Name', spanishText: 'Nombre Completo del Paciente', type: 'text', group: 'Demographics', required: true },
  { id: 'pap2', number: '2', text: 'Patient Primary Contact Phone #', spanishText: 'Teléfono de Contacto Primario', type: 'text', group: 'Demographics', required: true },
  { id: 'pap3', number: '3', text: 'Secondary Contact Ph#', spanishText: 'Teléfono de Contacto Secundario', type: 'text', group: 'Demographics', required: false, isSecondary: true },
  { id: 'pap4', number: '4', text: 'Patient Email Address', spanishText: 'Correo Electrónico del Paciente', type: 'text', group: 'Demographics', required: false },
  { id: 'pap5', number: '5', text: 'DOB', spanishText: 'Fecha de Nacimiento', type: 'text', group: 'Demographics', required: true },
  { id: 'pap6', number: '6', text: 'Home Address', spanishText: 'Dirección de Casa', type: 'text', group: 'Demographics', required: true },

  // Insurance
  { id: 'pap7', number: '7', text: 'Primary Insurance & Member ID#', spanishText: 'Seguro Primario y ID de Miembro', type: 'text', group: 'Insurance', required: true },
  { id: 'pap8', number: '8', text: 'Secondary Insurance & Member ID#', spanishText: 'Seguro Secundario y ID de Miembro', type: 'text', group: 'Insurance', required: false, isSecondary: true },
  { id: 'pap9', number: '9', text: 'SSN # (if insurance details N/A)', spanishText: 'SSN (si no hay detalles de seguro)', type: 'text', group: 'Insurance', required: false },

  // Clinical Information
  { id: 'pap10', number: '10', text: 'PCP Name', spanishText: 'Nombre del doctor primario', type: 'text', group: 'Clinical Information', required: true },
  { id: 'pap11', number: '11', text: 'MDO Ph#', spanishText: 'Teléfono de la oficina del doctor', type: 'text', group: 'Clinical Information', required: false },
  { id: 'pap12', number: '12', text: 'MDO Fax#', spanishText: 'Numero de Fax del doctor', type: 'text', group: 'Clinical Information', required: false },
  { id: 'pap13', number: '13', text: 'MDO Address', spanishText: 'Dirección del oficina', type: 'text', group: 'Clinical Information', required: false },
  { id: 'pap14', number: '14', text: 'Height', spanishText: 'Estatura', type: 'text', group: 'Clinical Information', required: true },
  { id: 'pap15', number: '15', text: 'Weight (lbs)', spanishText: 'Peso (libras)', type: 'text', group: 'Clinical Information', required: true },

  // PAP Details
  { id: 'pap16', number: '16', text: 'Already have a CPAP?', spanishText: '¿Ya tienes una CPAP/máquina?', type: 'select', group: 'PAP Details', required: true, options: ['Yes', 'No'],
    conditionalFormatting: { 'No': { bgColor: '#d4edda', textColor: '#155724' }, 'Yes': { bgColor: '#F7E891', textColor: '#7A6C21' } },
    isSecondary: true },
  { id: 'pap17', number: '17', text: 'Make & Model of current CPAP (if applicable)?', spanishText: '¿Marca y Modelo del CPAP (si aplica)?', type: 'text', group: 'PAP Details', required: false, isSecondary: true },
  { id: 'pap18', number: '18', text: 'How long have you had the current CPAP (if applicable)?', spanishText: '¿Cuánto tiempo ha tenido el CPAP (si aplica)?', type: 'select', group: 'PAP Details', required: false, isSecondary: true, options: ['Less than 5 years', 'More than 5 years', 'N/A'],
    conditionalFormatting: { 'Less than 5 years': { bgColor: '#F7E891', textColor: '#7A6C21' }, 'More than 5 years': { bgColor: '#d4edda', textColor: '#155724' } } },
  { id: 'pap19', number: '19', text: 'What kind of mask are you using (make/model/size)?', spanishText: '¿Qué tipo de mascarilla usa (marca/modelo/tamaño)?', type: 'text', group: 'PAP Details', required: false },
  { id: 'pap20', number: '20', text: 'Looking for Machine, PAP Supplies, or Both?', spanishText: '¿Busca Máquina, Suministros de PAP, o Ambos?', type: 'select', group: 'PAP Details', required: true, options: ['Machine', 'PAP Supplies', 'Both'] },
  { id: 'pap21', number: '21', text: 'Have you done a Sleep Study in the past?', spanishText: '¿Ha tenido un Estudio del Sueño en el pasado?', type: 'checkbox', group: 'PAP Details', required: false },
  { id: 'pap22', number: '22', text: 'If so please provide Sleep Study details (approx. date & provider details)', spanishText: 'Si es así, proporcione detalles (fecha y doctor)', type: 'text', group: 'PAP Details', required: false, isSecondary: true },
  { id: 'pap23', number: '23', text: 'Informed that we will reach out to MDO for the information required by insurance, and work with both to process your order efficiently.', spanishText: 'Se le informó que contactaremos al doctor para la información requerida por el seguro para aceptar su orden.', type: 'checkbox', group: 'PAP Details', required: true },
  { id: 'pap24', number: '24', text: 'Other Notes', spanishText: 'Otras notas', type: 'textarea', group: 'PAP Details', required: false, isSecondary: true },
];

const PAP_GROUPS = [
  'Demographics',
  'Insurance',
  'Clinical Information',
  'PAP Details',
];

export function getPapQuestions(): PapQuestion[] {
  return PAP_QUESTIONS;
}

export function getPapGroups(): string[] {
  return PAP_GROUPS;
}

/**
 * Validate PAP account creation responses server-side.
 * Returns an array of missing required question IDs, or empty if valid.
 */
export function validatePapResponses(
  responses: PapResponse[],
): { valid: boolean; missingRequired: string[] } {
  const answeredIds = new Set(
    responses
      .filter(r => r.answer !== null && r.answer !== undefined && String(r.answer).trim() !== '')
      .map(r => r.questionId)
  );
  const missingRequired = PAP_QUESTIONS
    .filter(q => q.required && !answeredIds.has(q.id))
    .map(q => q.id);
  return { valid: missingRequired.length === 0, missingRequired };
}
