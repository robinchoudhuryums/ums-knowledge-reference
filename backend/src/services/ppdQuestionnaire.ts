/**
 * PPD (Patient Provided Data) Questionnaire Service
 *
 * Provides the structured questionnaire for Power Mobility Device (PMD) orders.
 * Agents use this to conduct phone interviews with patients, collecting answers
 * that are used to pre-fill a Seating Evaluation sent to the medical provider.
 *
 * Two modes:
 * 1. Interactive questionnaire — agent fills in answers during a phone call
 * 2. Clinical note extraction — upload notes and auto-fill via the PPD extraction template
 */

export interface PpdQuestion {
  id: string;
  number: string;           // e.g., "1", "31a"
  text: string;
  spanishText: string;
  type: 'yes-no' | 'text' | 'select' | 'number' | 'multi-select';
  options?: string[];
  group: string;
  subQuestionOf?: string;   // parent question ID for conditional sub-questions
  showWhen?: string;        // value of parent that triggers this sub-question
  required: boolean;
}

export interface PpdResponse {
  questionId: string;
  answer: string | boolean | number | null;
}

export interface PpdSubmission {
  patientInfo: string;      // "Patient Name - Trx#"
  responses: PpdResponse[];
  language: 'english' | 'spanish';
  agentName: string;
  submittedAt: string;
  recommendedHcpcs?: PmdRecommendation[];
}

export interface PmdRecommendation {
  hcpcsCode: string;
  description: string;
  category: 'complex-rehab' | 'standard';
  justification: string;
  status?: 'accepted' | 'rejected' | 'undecided';
  preferred?: boolean;
}

// ─── Questionnaire Definition ────────────────────────────────────────

const PPD_QUESTIONS: PpdQuestion[] = [
  // MRADL Section
  { id: 'q1', number: '1', text: 'Do you currently use a cane, walker, manual wheelchair, scooter, or PWC?', spanishText: '¿Usa actualmente un bastón, andador, silla de ruedas manual, scooter o silla de ruedas motorizada (PWC)?', type: 'text', group: 'Current Mobility', required: true },
  { id: 'q2', number: '2', text: 'Going to the restroom and using the toilet', spanishText: 'Ir al baño y usar el inodoro', type: 'text', group: 'MRADLs', required: true },
  { id: 'q3', number: '3', text: 'Preparing meals in the kitchen', spanishText: 'Preparar comidas en la cocina', type: 'text', group: 'MRADLs', required: true },
  { id: 'q4', number: '4', text: 'Getting fully dressed', spanishText: 'Vestirse por completo', type: 'text', group: 'MRADLs', required: true },
  { id: 'q5', number: '5', text: 'Grooming (fixing hair, shaving, etc.)', spanishText: 'Asearse (peinarse, afeitarse, etc.)', type: 'text', group: 'MRADLs', required: true },
  { id: 'q6', number: '6', text: 'Bathing (getting in & out of shower/tub, washing all areas)', spanishText: 'Bañarse (entrar y salir de la ducha/bañera, lavarse todas las áreas)', type: 'text', group: 'MRADLs', required: true },

  // Extremity Strength
  { id: 'q7', number: '7', text: 'Can you move both arms at all?', spanishText: '¿Puede mover ambos brazos?', type: 'yes-no', group: 'Extremity Strength', required: true },
  { id: 'q8', number: '8', text: 'Can you raise both arms straight out in front of you, as if pointing?', spanishText: '¿Puede levantar ambos brazos rectos al frente, como si estuviera apuntando?', type: 'yes-no', group: 'Extremity Strength', required: true },
  { id: 'q9', number: '9', text: 'Can you raise both hands straight above your head?', spanishText: '¿Puede levantar ambas manos por encima de la cabeza?', type: 'yes-no', group: 'Extremity Strength', required: true },
  { id: 'q10', number: '10', text: 'Can you move your legs at all?', spanishText: '¿Puede mover las piernas?', type: 'yes-no', group: 'Extremity Strength', required: true },
  { id: 'q11', number: '11', text: 'While sitting, can you extend your legs straight out in front of you?', spanishText: 'Sentado/a, ¿puede extender las piernas rectas al frente?', type: 'yes-no', group: 'Extremity Strength', required: true },
  { id: 'q12', number: '12', text: 'Could you push an unlocked door open with your feet?', spanishText: '¿Podría empujar una puerta sin seguro con los pies?', type: 'yes-no', group: 'Extremity Strength', required: true },

  // Falls
  { id: 'q13', number: '13', text: 'Have you fallen, nearly fallen, or experienced dizziness in the past six months? If so, how many times?', spanishText: '¿Se ha caído, casi se ha caído o se ha mareado en los últimos seis meses? Si es así, ¿cuántas veces?', type: 'text', group: 'Falls & Safety', required: true },

  // Consistent Pain
  { id: 'q14', number: '14', text: 'Neck?', spanishText: '¿Cuello?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q15', number: '15', text: 'Shoulder?', spanishText: '¿Hombro?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q16', number: '16', text: 'Elbows?', spanishText: '¿Codos?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q17', number: '17', text: 'Arms?', spanishText: '¿Brazos?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q18', number: '18', text: 'Hands?', spanishText: '¿Manos?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q19', number: '19', text: 'Back?', spanishText: '¿Espalda?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q20', number: '20', text: 'Hips?', spanishText: '¿Caderas?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q21', number: '21', text: 'Knees?', spanishText: '¿Rodillas?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q22', number: '22', text: 'Legs?', spanishText: '¿Piernas?', type: 'yes-no', group: 'Consistent Pain', required: true },
  { id: 'q23', number: '23', text: 'Ankles?', spanishText: '¿Tobillos?', type: 'yes-no', group: 'Consistent Pain', required: true },

  // Additional Information
  { id: 'q24', number: '24', text: 'Do you take pain medications (over the counter or prescribed)?', spanishText: '¿Toma medicamentos para el dolor (de venta libre o recetados)?', type: 'text', group: 'Additional Information', required: true },
  { id: 'q25', number: '25', text: 'Do you have consistent or frequent numbness/tingling in hands, feet or legs?', spanishText: '¿Tiene entumecimiento u hormigueo en las manos, pies o piernas?', type: 'text', group: 'Additional Information', required: true },
  { id: 'q26', number: '26', text: 'Do you use caloric/nutritional supplements like Ensure or Boost?', spanishText: '¿Usa suplementos calóricos/nutricionales como Ensure o Boost?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q27', number: '27', text: 'Do you ever have the need for incontinence supplies?', spanishText: '¿Alguna vez necesita productos para la incontinencia?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q28', number: '28', text: 'Do you have diabetes?', spanishText: '¿Tiene diabetes?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q29', number: '29', text: 'Do you have any peripheral vascular disease?', spanishText: '¿Tiene alguna enfermedad vascular periférica?', type: 'text', group: 'Additional Information', required: true },
  { id: 'q30', number: '30', text: 'Do you use intermittent catheters?', spanishText: '¿Usa catéteres intermitentes?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q31', number: '31', text: 'Have you had a stroke in the past?', spanishText: '¿Ha tenido un derrame cerebral (stroke) en el pasado?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q31a', number: '31a', text: 'Did it result in weakness or paralysis in either side?', spanishText: '¿Resultó en debilidad o parálisis en alguno de los lados?', type: 'text', group: 'Additional Information', required: false, subQuestionOf: 'q31', showWhen: 'Yes' },
  { id: 'q32', number: '32', text: 'Do you have spasticity?', spanishText: '¿Tiene espasticidad?', type: 'text', group: 'Additional Information', required: true },
  { id: 'q33', number: '33', text: 'History of pressure ulcers or "bedsores"?', spanishText: '¿Historial de úlceras por presión o "escaras"?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q33a', number: '33a', text: 'If so, where and do you have absent or impaired sensation in that area?', spanishText: 'Si es así, ¿dónde? ¿Y tiene la sensación ausente o disminuida en esa área?', type: 'text', group: 'Additional Information', required: false, subQuestionOf: 'q33', showWhen: 'Yes' },
  { id: 'q34', number: '34', text: 'Any amputations? If so, where and is it above or below the knee?', spanishText: '¿Alguna amputación? Si es así, ¿dónde y es arriba o abajo de la rodilla?', type: 'text', group: 'Additional Information', required: true },
  { id: 'q35', number: '35', text: 'Any curvature of the spine (like scoliosis or humpback)?', spanishText: '¿Alguna curvatura en la columna (como escoliosis o joroba)?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q36', number: '36', text: 'Consistent swelling in feet, ankles, or legs?', spanishText: '¿Hinchazón constante en pies, tobillos o piernas?', type: 'yes-no', group: 'Additional Information', required: true },
  { id: 'q37', number: '37', text: 'Height (inches):', spanishText: 'Estatura (pulgadas):', type: 'number', group: 'Additional Information', required: true },
  { id: 'q38', number: '38', text: 'Weight (lbs):', spanishText: 'Peso (libras):', type: 'number', group: 'Additional Information', required: true },
  { id: 'q39', number: '39', text: 'Live alone or w/ friends/family?', spanishText: '¿Vive solo/a o con amigos/familia?', type: 'select', options: ['Lives alone', 'Lives with family/friends', 'Assisted living'], group: 'Additional Information', required: true },
  { id: 'q40', number: '40', text: 'Do you have a home health attendant at your home for a few hours per week?', spanishText: '¿Tiene un/a asistente de salud en casa algunas horas a la semana?', type: 'yes-no', group: 'Additional Information', required: false },

  // Diagnoses
  { id: 'q41', number: '41', text: 'What diagnoses do you have that would qualify you for the PWC?', spanishText: '¿Qué diagnósticos tiene que lo/la calificarían para la PWC?', type: 'text', group: 'Diagnoses', required: true },
  { id: 'q42', number: '42', text: 'Any heart or lung conditions not already mentioned?', spanishText: '¿Alguna condición cardíaca o pulmonar no mencionada?', type: 'text', group: 'Diagnoses', required: false },
  { id: 'q43', number: '43', text: 'Any neurological conditions not already mentioned?', spanishText: '¿Alguna condición neurológica no mencionada?', type: 'text', group: 'Diagnoses', required: false },
  { id: 'q44', number: '44', text: 'Are you on Oxygen?', spanishText: '¿Usa oxígeno?', type: 'yes-no', group: 'Diagnoses', required: true },
  { id: 'q45', number: '45', text: 'Do you have arthritis? If so, where and what type (Rheumatoid, Osteo, Psoriatic)?', spanishText: '¿Tiene artritis? Si es así, ¿dónde y de qué tipo (Reumatoide, Osteoartritis, Psoriásica)?', type: 'text', group: 'Diagnoses', required: true },
];

// ─── Question Groups (display order) ─────────────────────────────────

const QUESTION_GROUPS = [
  'Current Mobility',
  'MRADLs',
  'Extremity Strength',
  'Falls & Safety',
  'Consistent Pain',
  'Additional Information',
  'Diagnoses',
];

// ─── Exports ─────────────────────────────────────────────────────────

export function getPpdQuestions(): PpdQuestion[] {
  return PPD_QUESTIONS;
}

export function getPpdQuestionGroups(): string[] {
  return QUESTION_GROUPS;
}

export function getPpdQuestionById(id: string): PpdQuestion | undefined {
  return PPD_QUESTIONS.find(q => q.id === id);
}

/**
 * Determine PMD (Power Mobility Device) recommendations based on questionnaire responses.
 * This uses the patient's answers to suggest appropriate HCPCS codes.
 *
 * Logic factors:
 * - Weight → standard vs. heavy duty vs. extra heavy duty
 * - Extremity strength → Group 2 vs. Group 3 (need for multiple power options)
 * - Pain/spasticity/pressure ulcers → tilt/recline needs (Group 3)
 * - Neurological conditions → complex rehab vs. standard
 * - Upper extremity limitations → specialty controls (Group 4)
 */
export function determinePmdRecommendations(responses: PpdResponse[]): PmdRecommendation[] {
  const get = (id: string): string => {
    const r = responses.find(r => r.questionId === id);
    if (r === undefined || r.answer === null) return '';
    return String(r.answer).toLowerCase().trim();
  };

  const isYes = (id: string): boolean => {
    const val = get(id);
    return val === 'yes' || val === 'true';
  };

  const weight = parseFloat(get('q38')) || 0;
  const recommendations: PmdRecommendation[] = [];

  // ─── Determine weight class ────────────────────────────────────────
  let weightClass: 'standard' | 'heavy-duty' | 'very-heavy-duty' | 'extra-heavy-duty' = 'standard';
  if (weight > 600) weightClass = 'extra-heavy-duty';
  else if (weight > 450) weightClass = 'very-heavy-duty';
  else if (weight > 300) weightClass = 'heavy-duty';

  // ─── Determine if complex rehab is indicated ───────────────────────
  const hasNeuroCondition = get('q43').length > 3 && !get('q43').includes('no');
  const hasStroke = isYes('q31');
  const hasStrokeWeakness = get('q31a').length > 3;
  const hasSpasticity = get('q32').length > 3 && !get('q32').includes('no');
  const hasPressureUlcers = isYes('q33');
  const hasSpinalCurvature = isYes('q35');
  const hasAmputation = get('q34').length > 3 && !get('q34').includes('no');

  // ─── Determine tilt/recline need (Group 3 indicators) ─────────────
  const needsTiltRecline = hasPressureUlcers || hasSpasticity || hasSpinalCurvature ||
    (hasStroke && hasStrokeWeakness);

  // ─── Determine upper extremity limitations (Group 4 indicators) ────
  const cantMoveArms = !isYes('q7');
  const cantRaiseArms = !isYes('q8') && !isYes('q9');
  const severeUpperLimitation = cantMoveArms || (cantRaiseArms && hasNeuroCondition);

  // ─── Complex Rehab (Group 3 with multiple power options) ───────────
  const isComplexRehab = hasNeuroCondition || hasSpasticity || (hasStroke && hasStrokeWeakness) ||
    hasPressureUlcers || hasSpinalCurvature || hasAmputation;

  if (isComplexRehab && needsTiltRecline) {
    // Group 3 multiple power options (tilt + recline)
    const codeMap: Record<string, string> = {
      'standard': 'K0861',
      'heavy-duty': 'K0863',
      'very-heavy-duty': 'K0864',
      'extra-heavy-duty': 'K0864',
    };
    recommendations.push({
      hcpcsCode: codeMap[weightClass],
      description: `PWC Group 3, ${weightClass.replace(/-/g, ' ')}, multiple power options (tilt + recline)`,
      category: 'complex-rehab',
      justification: buildJustification(responses, 'group3-multi'),
    });

    // Also offer single power option
    const singleMap: Record<string, string> = {
      'standard': 'K0857',
      'heavy-duty': 'K0859',
      'very-heavy-duty': 'K0852',
      'extra-heavy-duty': 'K0854',
    };
    recommendations.push({
      hcpcsCode: singleMap[weightClass],
      description: `PWC Group 3, ${weightClass.replace(/-/g, ' ')}, single power option`,
      category: 'complex-rehab',
      justification: buildJustification(responses, 'group3-single'),
    });
  } else if (isComplexRehab) {
    // Group 3 standard (no power options, but complex rehab qualifying)
    const codeMap: Record<string, string> = {
      'standard': 'K0849',
      'heavy-duty': 'K0851',
      'very-heavy-duty': 'K0853',
      'extra-heavy-duty': 'K0855',
    };
    recommendations.push({
      hcpcsCode: codeMap[weightClass],
      description: `PWC Group 3, ${weightClass.replace(/-/g, ' ')}, captain chair`,
      category: 'complex-rehab',
      justification: buildJustification(responses, 'group3-std'),
    });
  }

  // ─── Group 4 (specialty controls) ──────────────────────────────────
  if (severeUpperLimitation) {
    recommendations.push({
      hcpcsCode: weightClass === 'heavy-duty' ? 'K0870' : 'K0869',
      description: `PWC Group 4, ${weightClass.replace(/-/g, ' ')}, specialty controls`,
      category: 'complex-rehab',
      justification: 'Severe upper extremity limitations require specialty input device (head control, sip-and-puff, etc.)',
    });
  }

  // ─── Standard Power Wheelchairs (Group 2) ──────────────────────────
  // Always offer Group 2 as a baseline option
  if (needsTiltRecline && !isComplexRehab) {
    // Group 2 with tilt and recline
    const codeMap: Record<string, string> = {
      'standard': 'K0836',
      'heavy-duty': 'K0839',
      'very-heavy-duty': 'K0840',
      'extra-heavy-duty': 'K0840',
    };
    recommendations.push({
      hcpcsCode: codeMap[weightClass],
      description: `PWC Group 2, ${weightClass.replace(/-/g, ' ')}, power tilt and recline`,
      category: 'standard',
      justification: buildJustification(responses, 'group2-tilt'),
    });
  }

  // Group 2 standard (always include as fallback)
  const stdMap: Record<string, string> = {
    'standard': 'K0820',
    'heavy-duty': 'K0823',
    'very-heavy-duty': 'K0825',
    'extra-heavy-duty': 'K0825',
  };
  recommendations.push({
    hcpcsCode: stdMap[weightClass],
    description: `PWC Group 2, ${weightClass.replace(/-/g, ' ')}, standard`,
    category: 'standard',
    justification: 'Standard power wheelchair meeting basic mobility needs. Lesser option if complex rehab criteria are not fully met.',
  });

  return recommendations;
}

function buildJustification(responses: PpdResponse[], type: string): string {
  const get = (id: string): string => {
    const r = responses.find(r => r.questionId === id);
    if (r === undefined || r.answer === null) return '';
    return String(r.answer).trim();
  };

  const factors: string[] = [];

  const weight = parseFloat(get('q38')) || 0;
  if (weight > 300) factors.push(`Patient weight ${weight} lbs requires heavy duty frame`);

  if (get('q43') && !get('q43').toLowerCase().includes('no')) {
    factors.push(`Neurological condition: ${get('q43')}`);
  }
  if (get('q32') && !get('q32').toLowerCase().includes('no')) {
    factors.push(`Spasticity present`);
  }
  if (get('q33')?.toLowerCase() === 'yes' || get('q33')?.toLowerCase() === 'true') {
    factors.push('History of pressure ulcers — tilt/recline needed for pressure relief');
  }
  if (get('q35')?.toLowerCase() === 'yes' || get('q35')?.toLowerCase() === 'true') {
    factors.push('Spinal curvature — positioning support needed');
  }
  if (get('q31')?.toLowerCase() === 'yes' || get('q31')?.toLowerCase() === 'true') {
    factors.push(`Stroke history${get('q31a') ? ': ' + get('q31a') : ''}`);
  }

  if (type === 'group3-multi') {
    factors.push('Multiple power options (tilt + recline) indicated for pressure management and positioning');
  } else if (type === 'group3-single') {
    factors.push('Single power option (tilt or recline) as alternative to multiple power');
  } else if (type === 'group2-tilt') {
    factors.push('Power tilt and recline for comfort and pressure management');
  }

  return factors.length > 0 ? factors.join('. ') + '.' : 'Meets basic criteria for power mobility device.';
}
