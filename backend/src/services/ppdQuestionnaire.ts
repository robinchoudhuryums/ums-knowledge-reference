import { PMD_CATALOG, getProductByHcpcs } from './pmdCatalog';

/**
 * Form version identifier. Increment when the question set or answer schema changes.
 * This is embedded in PPD submissions for audit traceability — if questions are
 * added, removed, or reworded, the version number tells you which form was used.
 */
export const PPD_FORM_VERSION = '2.0';

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
  imageUrl?: string;
  brochureUrl?: string;
  seatDimensions?: string;
  colors?: string;
  leadTime?: string;
  notes?: string;
  portable?: boolean;
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
 *
 * Ported from the original filterRecommendations.gs Apps Script logic.
 */
export function determinePmdRecommendations(responses: PpdResponse[]): PmdRecommendation[] {
  // ─── 1. Data Gathering ─────────────────────────────────────────────
  const get = (id: string): string => {
    const r = responses.find(r => r.questionId === id);
    if (r === undefined || r.answer === null) return '';
    return String(r.answer).toLowerCase().trim();
  };

  const isPositive = (id: string): boolean => {
    const val = get(id);
    return val.includes('yes') || val === 'true';
  };

  // Parse weight and clamp to realistic range (70-700 lbs).
  // Values outside this range are likely data entry errors (e.g. "12" from a
  // mistyped height, or "5000" from a keyboard slip). Treat as 0 (unknown).
  const rawWeight = parseInt(get('q38').replace(/\D/g, ''), 10) || 0;
  const weight = (rawWeight >= 70 && rawWeight <= 700) ? rawWeight : 0;
  const neuroCondition = get('q43');
  const numbnessAnswer = get('q25');
  const amputationStatus = get('q34');
  const strokeDetails = get('q31a');

  const hasSpineCurvature = isPositive('q35');
  const isOnOxygen = isPositive('q44');
  const hasPressureUlcers = isPositive('q33');
  // Spasticity detection — use explicit keywords with clinical context.
  // High-confidence keywords (spasm, spastic, clonus, rigid) match standalone.
  // Ambiguous keywords (stiff, tight) require a body-part context to avoid
  // false positives like "tight hamstrings" from normal exercise soreness.
  const spasticityAnswer = get('q32');
  const highConfidenceKeywords = ['spasm', 'spastic', 'spasticity', 'clonus', 'rigid', 'rigidity', 'hypertonia', 'hypertonicity'];
  const contextualKeywords = ['stiff', 'tight', 'tense']; // Only match near body parts
  const bodyPartContext = /(?:leg|arm|muscle|limb|joint|hand|foot|feet|knee|hip|shoulder|neck|trunk|back|thigh|calf|wrist|elbow|ankle)/i;
  // Negation check: if the answer starts with or contains "no" as a standalone denial, don't flag
  const isNegated = /^no\b|(?:^|\s)no\s+(?:spasm|spastic|stiff|tight)/i.test(spasticityAnswer);
  const hasSpasticity = !isNegated && (
    isPositive('q32') ||
    highConfidenceKeywords.some(kw => spasticityAnswer.includes(kw)) ||
    (contextualKeywords.some(kw => spasticityAnswer.includes(kw)) && bodyPartContext.test(spasticityAnswer))
  );
  const hasSwelling = isPositive('q36');
  const usesCatheters = isPositive('q30');

  const hasLowerExtremityNumbness = numbnessAnswer.includes('feet') || numbnessAnswer.includes('legs');

  const hasAmputation = (amputationStatus.includes('knee') ||
    amputationStatus.includes('left') ||
    amputationStatus.includes('right')) &&
    !amputationStatus.includes('no');

  // ─── Stroke Analysis ───────────────────────────────────────────────
  let qualifiesForHemiplegia = false;
  let hasStrokeWeakness = false;
  let hemiplegiaSide = '';

  if (strokeDetails && !strokeDetails.includes('no')) {
    const parts = strokeDetails.split(/[,;\n\r]+/);
    let rightParaCount = 0;
    let leftParaCount = 0;

    for (const raw of parts) {
      const p = raw.trim().toLowerCase();
      if (p.includes('weakness') || p.includes('paralysis')) {
        hasStrokeWeakness = true;
      }
      if (p.includes('paralysis')) {
        if (p.includes('right arm')) rightParaCount++;
        if (p.includes('right leg')) rightParaCount++;
        if (p.includes('right side')) rightParaCount += 2;
        if (p.includes('left arm')) leftParaCount++;
        if (p.includes('left leg')) leftParaCount++;
        if (p.includes('left side')) leftParaCount += 2;
      }
    }

    if (rightParaCount >= 2) {
      qualifiesForHemiplegia = true;
      hemiplegiaSide = 'Right';
    } else if (leftParaCount >= 2) {
      qualifiesForHemiplegia = true;
      hemiplegiaSide = 'Left';
    }
  }

  const hasValidNeuroDiagnosis = neuroCondition !== '' &&
    !['no', 'n/a', 'none', 'no.'].includes(neuroCondition);

  // ─── Eligibility Flags ─────────────────────────────────────────────
  const isNeuroEligible = hasValidNeuroDiagnosis || hasSpasticity || qualifiesForHemiplegia;

  const isSPOEligible = hasSwelling ||
    hasPressureUlcers ||
    isNeuroEligible ||
    usesCatheters ||
    hasSpineCurvature ||
    hasAmputation;

  const isMPOEligible = usesCatheters || isNeuroEligible;

  // ─── 2. Filter Products from Catalog ───────────────────────────────
  const inherentlySolidCodes = [
    'K0822', 'K0824', 'K0826', 'K0828',
    'K0835', 'K0837', 'K0839',
    'K0840', 'K0841', 'K0843',
    'K0848', 'K0849', 'K0850', 'K0851',
    'K0856', 'K0857', 'K0858', 'K0859',
    'K0861', 'K0862', 'K0863', 'K0864',
  ];

  const eligibleProducts = PMD_CATALOG.filter((product: { hcpcs: string; seatType: string; weightCapacity: string }) => {
    const hcpcs = product.hcpcs.trim();
    const hcpcsNum = parseInt(hcpcs.replace(/\D/g, ''), 10) || 0;
    if (hcpcsNum === 0) return false;

    const seatCode = product.seatType.toLowerCase().trim();
    const isKnownSolid = inherentlySolidCodes.includes(hcpcs);
    const sheetSaysSolid = seatCode.includes('s');
    const offersSolid = isKnownSolid || sheetSaysSolid;
    const offersCaptain = seatCode.includes('c') && !isKnownSolid && !sheetSaysSolid;

    // Weight filtering — validate parsed numbers to avoid NaN comparisons
    if (weight > 0) {
      if (product.weightCapacity.includes('-')) {
        const parts = product.weightCapacity.split('-').map(n => parseInt(n, 10));
        const minCap = parts[0];
        const maxCap = parts[1];
        if (isNaN(minCap) || isNaN(maxCap) || parts.length !== 2) return false;
        if (weight < minCap || weight > maxCap) return false;
      } else {
        const maxCap = parseInt(product.weightCapacity, 10);
        if (isNaN(maxCap)) return false;
        if (weight > maxCap) return false;
      }
    }

    const isGroup3 = hcpcsNum >= 848;
    const isMPO = (hcpcsNum >= 840 && hcpcsNum <= 843) || (hcpcsNum >= 861 && hcpcsNum <= 864);
    const isSPO = (hcpcsNum >= 835 && hcpcsNum <= 839) || (hcpcsNum >= 856 && hcpcsNum <= 859);

    // Solid seat requirement
    const needsSolidSeat = hasSpineCurvature ||
      hasPressureUlcers ||
      hasSpasticity ||
      hasValidNeuroDiagnosis ||
      qualifiesForHemiplegia ||
      hasStrokeWeakness ||
      hasLowerExtremityNumbness ||
      usesCatheters ||
      hasAmputation;

    if (needsSolidSeat) {
      if (!offersSolid) return false;
    } else {
      if (!isGroup3 && !offersCaptain) return false;
    }

    // Oxygen conflict
    if (isOnOxygen && (hcpcs === 'K0837' || hcpcs === 'K0838')) return false;

    // Group/power eligibility
    if (isGroup3 && !isNeuroEligible) return false;
    if (isMPO && !isMPOEligible) return false;
    if (isSPO && !isSPOEligible) return false;

    return true;
  });

  // ─── 3. Substitution Rules ─────────────────────────────────────────
  const substitutions: Record<string, string> = {
    'K0856': 'K0861',
    'K0838': 'K0837',
  };

  type ProductEntry = { hcpcs: string; brochureUrl: string; imageUrl: string; seatType: string; features: string; weightCapacity: string; seatDimensions?: string; colors?: string; leadTime?: string; notes?: string; portable?: boolean };
  const processedMap = new Map<string, ProductEntry>();

  for (const product of eligibleProducts) {
    let finalHcpcs = product.hcpcs.trim();
    let finalProduct = { ...product };

    // K0841/K0842/K0843 → upgrade to Group 3 if neuro-eligible
    if (['K0841', 'K0842', 'K0843'].includes(finalHcpcs)) {
      if (isNeuroEligible) {
        finalHcpcs = finalHcpcs === 'K0843' ? 'K0862' : 'K0861';
        const target = getProductByHcpcs(finalHcpcs);
        if (target) {
          finalProduct = { ...finalProduct, hcpcs: finalHcpcs, brochureUrl: target.brochureUrl, imageUrl: target.imageUrl };
        }
      }
    } else if (substitutions[finalHcpcs]) {
      const targetHcpcs = substitutions[finalHcpcs];
      const targetIsGroup3 = parseInt(targetHcpcs.replace(/\D/g, ''), 10) >= 848;
      const originalIsGroup2 = parseInt(finalHcpcs.replace(/\D/g, ''), 10) < 848;

      if (originalIsGroup2 && targetIsGroup3 && !isNeuroEligible) {
        // Keep original — can't upgrade without neuro eligibility
      } else {
        finalHcpcs = targetHcpcs;
        const target = getProductByHcpcs(targetHcpcs);
        if (target) {
          finalProduct = { ...finalProduct, hcpcs: finalHcpcs, brochureUrl: target.brochureUrl, imageUrl: target.imageUrl };
        }
      }
    }

    if (!processedMap.has(finalHcpcs)) {
      processedMap.set(finalHcpcs, finalProduct);
    }
  }

  // ─── 4. Sort & Justify ─────────────────────────────────────────────
  const results: PmdRecommendation[] = [];

  for (const [, p] of processedMap) {
    const hcpcsNum = parseInt(p.hcpcs.replace(/\D/g, ''), 10) || 0;
    const isGroup3 = hcpcsNum >= 848;
    const isComplex = hcpcsNum >= 835;
    const isSPO = (hcpcsNum >= 835 && hcpcsNum <= 839) || (hcpcsNum >= 856 && hcpcsNum <= 859);

    const isKnownSolid = inherentlySolidCodes.includes(p.hcpcs);
    const seatCode = p.seatType.toLowerCase();
    const sheetSaysSolid = seatCode.includes('s');
    const offersSolid = isKnownSolid || sheetSaysSolid;
    const isCaptainOnly = seatCode.includes('c') && !offersSolid;

    let displayHcpcs = p.hcpcs;
    let justification = 'Eligible option';

    if (isGroup3) {
      const reasons: string[] = [];
      if (hasValidNeuroDiagnosis) reasons.push('Neuro Dx');
      if (hasSpasticity) reasons.push('Spasticity');
      if (qualifiesForHemiplegia) reasons.push(`Hemiplegia (${hemiplegiaSide} Side)`);
      if (hasAmputation) reasons.push('Amputation');
      justification = `Medically Necessary Upgrade due to: ${reasons.join(', ')}`;
    } else {
      const solidReasons: string[] = [];
      if (hasPressureUlcers) solidReasons.push('Pressure Ulcers');
      if (hasSpineCurvature) solidReasons.push('Spinal Curvature');
      if (hasLowerExtremityNumbness) solidReasons.push('Impaired Sensation');
      if (hasSpasticity) solidReasons.push('Spasticity');
      if (hasValidNeuroDiagnosis) solidReasons.push('Neuro Dx');
      if (hasStrokeWeakness && !qualifiesForHemiplegia) solidReasons.push('CVA/Stroke Weakness');
      if (hasAmputation) solidReasons.push('Amputation (Center of Gravity/Pressure Relief)');
      if (usesCatheters) solidReasons.push('Intermittent Catheterization');

      if (isSPO) {
        const spoReasons: string[] = [];
        if (hasSwelling) spoReasons.push('Power Legs (Edema)');
        if (hasPressureUlcers) spoReasons.push('Power Tilt (Pressure Relief)');
        if (hasSpineCurvature || hasAmputation || isNeuroEligible) spoReasons.push('Power Tilt (Positioning/Stability)');
        if (usesCatheters) spoReasons.push('Power Tilt (Catheterization)');
        justification = `Indicated for: ${spoReasons.length > 0 ? spoReasons.join(', ') : 'Power Accessory'}`;
      }

      if (solidReasons.length > 0 && offersSolid) {
        if (justification === 'Eligible option') justification = '';
        else justification += ' | ';
        justification += `Solid Seat indicated for: ${solidReasons.join(', ')}`;
      } else if (!isSPO && offersSolid) {
        if (justification === 'Eligible option') justification = 'Solid Seat';
        else justification += ' (Solid Seat)';
      } else if (isCaptainOnly && !isSPO) {
        justification = "Captain's Seat";
      }

      // Substitution display for K0841/K0842/K0843
      if (['K0841', 'K0842', 'K0843'].includes(p.hcpcs)) {
        const subTarget = p.hcpcs === 'K0843' ? 'K0862' : 'K0861';
        displayHcpcs = `${p.hcpcs} (substitute ${subTarget})`;
        let reason = 'MPO';
        if (usesCatheters) reason += ' (for Intermittent Cath)';
        justification = `${reason} — Provide ${subTarget} as free upgrade`;
      }

      if (['K0800', 'K0801'].includes(p.hcpcs)) {
        justification += ' | (if POV eligible)';
      }
    }

    results.push({
      hcpcsCode: displayHcpcs,
      description: p.features,
      category: isComplex ? 'complex-rehab' : 'standard',
      justification,
      imageUrl: p.imageUrl,
      brochureUrl: p.brochureUrl,
      seatDimensions: p.seatDimensions,
      colors: p.colors,
      leadTime: p.leadTime,
      notes: p.notes,
      portable: p.portable,
    });
  }

  // Sort: higher HCPCS numbers first (complex rehab on top)
  results.sort((a, b) => {
    const aNum = parseInt(a.hcpcsCode.replace(/\D/g, ''), 10) || 0;
    const bNum = parseInt(b.hcpcsCode.replace(/\D/g, ''), 10) || 0;
    return bNum - aNum;
  });

  return results;
}
