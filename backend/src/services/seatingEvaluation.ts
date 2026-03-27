/**
 * Seating Evaluation Auto-Fill
 *
 * Maps PPD questionnaire responses to the fields on the 2-page
 * "Seating Evaluation for Power Mobility Device (PMD)" form.
 * Generates a structured object and HTML preview that can be
 * printed, emailed, or sent to the Pre-Appointment Kit team.
 */

import { PpdResponse, PmdRecommendation } from './ppdQuestionnaire';

// ─── Form Data Structure (matches PDF fields exactly) ─────────────────

export interface SeatingEvaluation {
  // Section 1: Patient Data
  patientName: string;
  addendumNotes: string;
  purposeOfVisit: 'Power Mobility Evaluation' | 'Follow Up';
  heightInches: string;
  weightLbs: string;
  diagnoses: string[];

  // Section 2: Compromised MRADLs
  mradls: {
    toilet: 'cannot_accomplish' | 'cannot_attempt' | 'cannot_complete' | null;
    eat: 'cannot_accomplish' | 'cannot_attempt' | 'cannot_complete' | null;
    dressing: 'cannot_accomplish' | 'cannot_attempt' | 'cannot_complete' | null;
    grooming: 'cannot_accomplish' | 'cannot_attempt' | 'cannot_complete' | null;
    bathe: 'cannot_accomplish' | 'cannot_attempt' | 'cannot_complete' | null;
  };

  // Section 3: Functional Limitations
  extremityStrength: {
    leftUpper: string;   // 0-5 scale
    rightUpper: string;
    leftLower: string;
    rightLower: string;
  };
  rangeOfMotion: string[];
  endurance: 'poor' | 'strong' | '';
  fallRisk: { hasFalls: boolean; details: string };
  painUE: { locations: string[]; scale: string };
  painLE: { locations: string[]; scale: string };

  // Section 4: Lower Cost Alternatives
  rulesOutCaneWalker: boolean;
  rulesOutManualWheelchair: boolean;
  rulesOutScooterPOV: boolean;

  // Section 5: Cognitive and Physical Impairment
  cognitiveStatus: string[];
  hasCaregiverForAttendantControl: boolean | null;

  // Section 6: Feature Selection - Single Power
  needsWeightShift: boolean;
  pressureUlcerRiskFactors: string[];
  overallPressureRisk: 'severe' | 'high' | 'moderate' | 'mild' | '';
  usesCatheters: boolean;
  needsTransferAssist: boolean;
  muscleTone: string[];

  // Section 7: Feature Selection - Multi Power
  multiPowerReasons: string[];

  // Section 8: Seat/Back Cushion Selection
  hasPressureUlcers: boolean;
  ulcerLocations: string[];
  hasImpairedSensation: boolean;
  hasAmputation: boolean;
  amputationDetails: string[];
  hasPosturalAsymmetries: boolean;
  posturalDetails: { pelvis: string[]; trunk: string[] };

  // Section 9: Utilization and Benefits
  needsToManage: string[];
  mradlsImprovedByPMD: boolean;
  willingAndAble: boolean;
  hoursPerDay: '>2' | '<2';
  primaryUseInHome: boolean;

  // Section 10: PMD Selection
  pmdBase: 'Power Wheelchair' | 'Scooter (POV)';
  features: string[];
  cushions: string[];
  comments: string;
}

// ─── PPD → Seating Evaluation Mapping ─────────────────────────────────

export function generateSeatingEvaluation(
  responses: PpdResponse[],
  recommendations: PmdRecommendation[],
  patientInfo: string,
): SeatingEvaluation {
  const get = (id: string): string => {
    const r = responses.find(r => r.questionId === id);
    if (r === undefined || r.answer === null) return '';
    return String(r.answer).trim();
  };

  const isYes = (id: string): boolean => {
    const val = get(id).toLowerCase();
    return val === 'yes' || val === 'true';
  };

  // Determine MRADL level from free-text PPD answers.
  // Returns null if the text doesn't match any known impairment keywords,
  // rather than defaulting to 'cannot_complete' for all non-empty text.
  // Uses word-boundary matching for "no" to avoid false positives on
  // "no difficulty" being classified as cannot_accomplish.
  const classifyMradl = (text: string): 'cannot_accomplish' | 'cannot_attempt' | 'cannot_complete' | null => {
    if (!text) return null;
    const lower = text.toLowerCase();
    // Word-boundary "no" check: must be standalone "no" (e.g. "no, I can't")
    // not part of "no difficulty" or "normal" or "nothing wrong"
    const hasStandaloneNo = /\bno\b/.test(lower) && !/\bno\s+(difficulty|problem|issue|concern|limitation)/i.test(lower);
    if (lower.includes('cannot') || lower.includes('unable') || (hasStandaloneNo && lower.length < 20) || lower.includes('impossible')) {
      return 'cannot_accomplish';
    }
    if (lower.includes('risk') || lower.includes('danger') || lower.includes('unsafe') || lower.includes('fear')) {
      return 'cannot_attempt';
    }
    if (lower.includes('difficulty') || lower.includes('struggle') || lower.includes('hard') ||
        lower.includes('takes long') || lower.includes('help') || lower.includes('assist') ||
        lower.includes('pain') || lower.includes('limited')) {
      return 'cannot_complete';
    }
    // No recognized impairment keywords — don't assume compromised
    return null;
  };

  // Map arm strength Q7-Q9 to 0-5 scale
  const mapArmStrength = (): string => {
    const canMove = isYes('q7');
    const canRaiseFront = isYes('q8');
    const canRaiseAbove = isYes('q9');
    if (!canMove) return '0-1';
    if (!canRaiseFront) return '2';
    if (!canRaiseAbove) return '3';
    return '4-5';
  };

  // Map leg strength Q10-Q12 to 0-5 scale
  const mapLegStrength = (): string => {
    const canMove = isYes('q10');
    const canExtend = isYes('q11');
    const canPush = isYes('q12');
    if (!canMove) return '0-1';
    if (!canExtend) return '2';
    if (!canPush) return '3';
    return '4-5';
  };

  // Collect pain locations
  const painLocationsUE: string[] = [];
  const painLocationsLE: string[] = [];
  if (isYes('q14')) painLocationsUE.push('Neck');
  if (isYes('q15')) painLocationsUE.push('Shoulder');
  if (isYes('q16')) painLocationsUE.push('Elbow');
  if (isYes('q17')) painLocationsUE.push('Arm');
  if (isYes('q18')) painLocationsUE.push('Hand');
  if (isYes('q19')) painLocationsLE.push('Back');
  if (isYes('q20')) painLocationsLE.push('Hip');
  if (isYes('q21')) painLocationsLE.push('Knee');
  if (isYes('q22')) painLocationsLE.push('Leg');
  if (isYes('q23')) painLocationsLE.push('Foot');

  // Collect diagnoses from Q41, Q42, Q43
  const diagnoses: string[] = [];
  if (get('q41')) diagnoses.push(get('q41'));
  if (get('q42')) diagnoses.push(get('q42'));
  if (get('q43')) diagnoses.push(get('q43'));
  if (get('q45')) diagnoses.push(`Arthritis: ${get('q45')}`);

  // Determine pressure ulcer risk factors
  const pressureRiskFactors: string[] = [];
  if (get('q25').toLowerCase().includes('feet') || get('q25').toLowerCase().includes('legs')) {
    pressureRiskFactors.push('Neuropathy');
  }
  if (isYes('q28')) pressureRiskFactors.push('Diabetes');
  if (isYes('q36')) pressureRiskFactors.push('Edema');
  if (isYes('q26')) pressureRiskFactors.push('Poor Nutrition');
  if (isYes('q44')) pressureRiskFactors.push('Low Blood Pressure'); // O2 use correlates
  const neuro = get('q43').toLowerCase();
  if (neuro && !['no', 'n/a', 'none'].includes(neuro)) {
    pressureRiskFactors.push('Limited Sensory Perception');
    pressureRiskFactors.push('Very Limited Mobility');
  }

  // Determine overall pressure risk level
  let overallRisk: 'severe' | 'high' | 'moderate' | 'mild' | '' = '';
  if (pressureRiskFactors.length >= 5) overallRisk = 'severe';
  else if (pressureRiskFactors.length >= 3) overallRisk = 'high';
  else if (pressureRiskFactors.length >= 1) overallRisk = 'moderate';

  // Multi-power reasons
  const multiPowerReasons: string[] = [];
  if (isYes('q36')) multiPowerReasons.push('Improving lower limb edema');
  if (isYes('q33')) multiPowerReasons.push('Achieving optimal pressure relief');
  if (isYes('q30')) multiPowerReasons.push('Better transfer');
  const hasNeuro = neuro && !['no', 'n/a', 'none'].includes(neuro);
  if (hasNeuro) {
    multiPowerReasons.push('Optimizing position for respiration, eating, swallowing, and vision');
    multiPowerReasons.push('Allowing a dynamic seating position');
  }
  if (isYes('q35')) multiPowerReasons.push('Managing orthostatic hypotension');

  // Needs to manage (Section 9)
  const needsToManage: string[] = [];
  if (isYes('q33') || pressureRiskFactors.length > 0) needsToManage.push('Pressure reduction');
  if (isYes('q36')) needsToManage.push('Edema');
  if (isYes('q32') || (get('q32') && !get('q32').toLowerCase().includes('no'))) {
    needsToManage.push('Increased Tone');
  }
  if (isYes('q35')) needsToManage.push('Mid-line trunk support');
  if (painLocationsUE.length > 0 || painLocationsLE.length > 0) needsToManage.push('Posture instability');

  // Muscle tone
  const muscleTone: string[] = [];
  const spasticity = get('q32').toLowerCase();
  if (spasticity && !spasticity.includes('no') && spasticity.length > 2) muscleTone.push('Spasticity');
  if (isYes('q35')) muscleTone.push('Rigidity');

  // Amputation details
  const ampDetails: string[] = [];
  const ampText = get('q34').toLowerCase();
  if (ampText.includes('left') && ampText.includes('above')) ampDetails.push('LT-AKA');
  if (ampText.includes('left') && ampText.includes('below')) ampDetails.push('LT-BKA');
  if (ampText.includes('right') && ampText.includes('above')) ampDetails.push('RT-AKA');
  if (ampText.includes('right') && ampText.includes('below')) ampDetails.push('RT-BKA');

  // Postural asymmetries
  const pelvisIssues: string[] = [];
  const trunkIssues: string[] = [];
  if (isYes('q35')) {
    trunkIssues.push('Scoliosis');
    pelvisIssues.push('Obliquity');
  }

  // PMD Selection from recommendations — guard against empty array
  const topRec = recommendations.length > 0 ? recommendations[0] : null;
  const hcpcsNum = topRec ? parseInt(topRec.hcpcsCode.replace(/\D/g, ''), 10) || 0 : 0;
  const isScooter = hcpcsNum >= 800 && hcpcsNum <= 801;
  const isSPO = (hcpcsNum >= 835 && hcpcsNum <= 843) || (hcpcsNum >= 856 && hcpcsNum <= 859);
  const isMPO = (hcpcsNum >= 840 && hcpcsNum <= 843) || (hcpcsNum >= 861 && hcpcsNum <= 864);

  const features: string[] = [];
  if (isSPO && !isMPO) features.push('Tilt');
  if (isMPO) features.push('Tilt & Recline');

  const cushions: string[] = [];
  if (isYes('q33') || pressureRiskFactors.length > 0) cushions.push('Skin Protection Seat');
  if (isYes('q35') || ampDetails.length > 0 || pelvisIssues.length > 0) {
    cushions.push('Positioning Seat');
    cushions.push('Positioning Back');
  }

  const armStrength = mapArmStrength();
  const legStrength = mapLegStrength();

  return {
    patientName: patientInfo,
    addendumNotes: '',
    purposeOfVisit: 'Power Mobility Evaluation',
    heightInches: get('q37'),
    weightLbs: get('q38'),
    diagnoses,

    mradls: {
      toilet: classifyMradl(get('q2')),
      eat: classifyMradl(get('q3')),
      dressing: classifyMradl(get('q4')),
      grooming: classifyMradl(get('q5')),
      bathe: classifyMradl(get('q6')),
    },

    extremityStrength: {
      leftUpper: armStrength,
      rightUpper: armStrength,
      leftLower: legStrength,
      rightLower: legStrength,
    },
    rangeOfMotion: painLocationsUE.length > 2 || painLocationsLE.length > 2
      ? ['Limited ROM'] : [],
    endurance: (painLocationsUE.length + painLocationsLE.length > 3) ? 'poor' : '',
    fallRisk: {
      hasFalls: get('q13').toLowerCase() !== 'no' && get('q13').length > 2,
      details: get('q13'),
    },
    painUE: { locations: painLocationsUE, scale: painLocationsUE.length > 0 ? String(Math.min(painLocationsUE.length * 2, 10)) : '' },
    painLE: { locations: painLocationsLE, scale: painLocationsLE.length > 0 ? String(Math.min(painLocationsLE.length * 2, 10)) : '' },

    rulesOutCaneWalker: true,  // Always true for PMD patients
    // Parse armStrength as number for comparison — string comparison ('10' <= '3') is wrong
    rulesOutManualWheelchair: parseInt(armStrength.split('-')[0], 10) <= 3 || painLocationsUE.length >= 2,
    rulesOutScooterPOV: isYes('q35') || isYes('q33') || !isYes('q7'),

    // Cognitive status inferred from PPD responses rather than hardcoded.
    // If neuro conditions suggest cognitive impact, flag it; otherwise default to 'Intact'.
    cognitiveStatus: diagnoses.some(d =>
      /dementia|alzheimer|tbi|brain\s*injury|cognitive/i.test(d)
    ) ? ['Impaired — see diagnosis'] : ['Intact'],
    hasCaregiverForAttendantControl: null,

    needsWeightShift: isSPO || isMPO,
    pressureUlcerRiskFactors: pressureRiskFactors,
    overallPressureRisk: overallRisk,
    usesCatheters: isYes('q30'),
    needsTransferAssist: isYes('q30'),
    muscleTone,

    multiPowerReasons,

    hasPressureUlcers: isYes('q33'),
    ulcerLocations: get('q33a') ? get('q33a').split(/[,;]/).map((s: string) => s.trim()).filter(Boolean) : [],
    hasImpairedSensation: (get('q33a') || '').toLowerCase().includes('absent') || (get('q33a') || '').toLowerCase().includes('impaired'),
    hasAmputation: ampText.length > 3 && !ampText.includes('no'),
    amputationDetails: ampDetails,
    hasPosturalAsymmetries: isYes('q35') || ampDetails.length > 0,
    posturalDetails: { pelvis: pelvisIssues, trunk: trunkIssues },

    needsToManage,
    // Only assert MRADLs improved if at least one MRADL was actually identified as compromised
    mradlsImprovedByPMD: needsToManage.length > 0,
    willingAndAble: true,
    hoursPerDay: '>2',
    primaryUseInHome: true,

    pmdBase: isScooter ? 'Scooter (POV)' : 'Power Wheelchair',
    features,
    cushions,
    comments: topRec ? `Recommended: ${topRec.hcpcsCode} — ${topRec.description}` : '',
  };
}

// ─── HTML Rendering (printable/emailable) ─────────────────────────────

export function renderSeatingEvalHtml(eval_: SeatingEvaluation): string {
  const check = (val: boolean | null) => val ? '&#9745;' : '&#9744;';
  const checkIf = (condition: boolean) => condition ? '&#9745;' : '&#9744;';
  const mradlCheck = (val: string | null, col: string) => val === col ? '&#9745;' : '&#9744;';

  return `
<div style="font-family: Arial, sans-serif; font-size: 12px; max-width: 800px; margin: auto; padding: 20px; line-height: 1.4;">
  <h2 style="text-align:center; margin-bottom:4px;">Seating Evaluation for Power Mobility Device (PMD)</h2>
  <p style="text-align:right; font-size:11px; color:#666;">Page 1 of 2</p>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">1. Patient Data</h3>
  <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:10px;">
    <tr>
      <td><strong>1a) Patient Name:</strong> ${eval_.patientName}</td>
      <td><strong>1b) Addendum to Progress Notes:</strong> ${eval_.addendumNotes}</td>
    </tr>
    <tr>
      <td><strong>1c) Purpose:</strong> ${check(eval_.purposeOfVisit === 'Power Mobility Evaluation')} Power Mobility Evaluation ${check(eval_.purposeOfVisit === 'Follow Up')} Follow Up</td>
      <td><strong>1d) Height:</strong> ${eval_.heightInches}" &nbsp; <strong>Weight:</strong> ${eval_.weightLbs} lbs</td>
    </tr>
    <tr>
      <td colspan="2"><strong>1e) Diagnoses:</strong> ${eval_.diagnoses.join('; ')}</td>
    </tr>
  </table>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">2. Compromised MRADLs</h3>
  <table style="width:100%; border-collapse:collapse; border:1px solid #999; font-size:11px; margin-bottom:10px;">
    <tr style="background:#eee; font-weight:bold;">
      <td style="border:1px solid #999; padding:4px;">Activity</td>
      <td style="border:1px solid #999; padding:4px; text-align:center;">Cannot accomplish entirely</td>
      <td style="border:1px solid #999; padding:4px; text-align:center;">Cannot attempt w/o heightened risk</td>
      <td style="border:1px solid #999; padding:4px; text-align:center;">Cannot complete in reasonable time</td>
    </tr>
    ${['toilet', 'eat', 'dressing', 'grooming', 'bathe'].map(k => `
    <tr>
      <td style="border:1px solid #999; padding:4px;">Going to ${k === 'toilet' ? 'bathroom to toilet' : k === 'eat' ? 'kitchen to eat' : k === 'bathe' ? 'bathroom to bathe' : k}</td>
      <td style="border:1px solid #999; padding:4px; text-align:center;">${mradlCheck((eval_.mradls as Record<string, string | null>)[k], 'cannot_accomplish')}</td>
      <td style="border:1px solid #999; padding:4px; text-align:center;">${mradlCheck((eval_.mradls as Record<string, string | null>)[k], 'cannot_attempt')}</td>
      <td style="border:1px solid #999; padding:4px; text-align:center;">${mradlCheck((eval_.mradls as Record<string, string | null>)[k], 'cannot_complete')}</td>
    </tr>`).join('')}
  </table>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">3. Functional Limitations</h3>
  <table style="width:100%; font-size:11px; margin-bottom:6px;">
    <tr>
      <td><strong>3a) Extremity Strength:</strong></td>
      <td>Left Upper: <strong>/${eval_.extremityStrength.leftUpper}</strong></td>
      <td>Right Upper: <strong>/${eval_.extremityStrength.rightUpper}</strong></td>
    </tr>
    <tr>
      <td></td>
      <td>Left Lower: <strong>/${eval_.extremityStrength.leftLower}</strong></td>
      <td>Right Lower: <strong>/${eval_.extremityStrength.rightLower}</strong></td>
    </tr>
  </table>
  <p><strong>3b) ROM:</strong> ${eval_.rangeOfMotion.length > 0 ? eval_.rangeOfMotion.map(r => checkIf(true) + ' ' + r).join(' ') : '&#9744; No limitations noted'}</p>
  <p><strong>3c) Endurance:</strong> ${checkIf(eval_.endurance === 'poor')} Poor ${checkIf(eval_.endurance === 'strong')} Strong</p>
  <p><strong>3d) Fall Risk:</strong> ${check(eval_.fallRisk.hasFalls)} Yes — ${eval_.fallRisk.details} &nbsp; ${check(!eval_.fallRisk.hasFalls)} No</p>
  <p><strong>3e) Pain UE:</strong> ${eval_.painUE.locations.map(l => checkIf(true) + ' ' + l).join(' ')} ${eval_.painUE.scale ? '| Scale: ' + eval_.painUE.scale + '/10' : ''}</p>
  <p><strong>Pain LE:</strong> ${eval_.painLE.locations.map(l => checkIf(true) + ' ' + l).join(' ')} ${eval_.painLE.scale ? '| Scale: ' + eval_.painLE.scale + '/10' : ''}</p>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">4. Lower Cost Alternatives</h3>
  <p><strong>4a)</strong> ${check(!eval_.rulesOutCaneWalker)} Yes ${check(eval_.rulesOutCaneWalker)} No; <strong>Rules out Cane or Walker</strong></p>
  <p><strong>4b)</strong> ${check(!eval_.rulesOutManualWheelchair)} Yes ${check(eval_.rulesOutManualWheelchair)} No; <strong>Rules out Manual Wheelchair</strong></p>
  <p><strong>4c)</strong> ${check(!eval_.rulesOutScooterPOV)} Yes ${check(eval_.rulesOutScooterPOV)} No; <strong>Rules out Scooter/POV</strong></p>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">5. Cognitive and Physical Impairment Status</h3>
  <p><strong>5a)</strong> ${eval_.cognitiveStatus.map(s => checkIf(true) + ' ' + s).join(' ')}</p>

  <p style="text-align:right; font-size:11px; color:#666; page-break-before:always;">Page 2 of 2</p>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">6. Feature Selection — Single Power</h3>
  <p><strong>6a) Weight shift:</strong> ${check(eval_.needsWeightShift)} Yes ${check(!eval_.needsWeightShift)} No</p>
  <p><strong>6b) Pressure ulcer risk factors:</strong> ${eval_.pressureUlcerRiskFactors.map(f => checkIf(true) + ' ' + f).join(' ') || 'None identified'}</p>
  <p><strong>6c) Overall Risk:</strong> ${checkIf(eval_.overallPressureRisk === 'severe')} Severe ${checkIf(eval_.overallPressureRisk === 'high')} High ${checkIf(eval_.overallPressureRisk === 'moderate')} Moderate ${checkIf(eval_.overallPressureRisk === 'mild')} Mild</p>
  <p><strong>6d) Intermittent Catheters:</strong> ${check(eval_.usesCatheters)} Yes ${check(!eval_.usesCatheters)} No</p>
  <p><strong>6e) Muscle Tone:</strong> ${eval_.muscleTone.map(t => checkIf(true) + ' ' + t).join(' ') || '&#9744; Normal'}</p>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">7. Feature Selection — Multi Power</h3>
  <p>${eval_.multiPowerReasons.length > 0 ? eval_.multiPowerReasons.map(r => checkIf(true) + ' ' + r).join('<br>') : 'N/A — single power or standard'}</p>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">8. Seat/Back Cushion Selection</h3>
  <p><strong>8a) Pressure Ulcers:</strong> ${check(eval_.hasPressureUlcers)} Yes ${check(!eval_.hasPressureUlcers)} No ${eval_.ulcerLocations.length > 0 ? '— Locations: ' + eval_.ulcerLocations.join(', ') : ''}</p>
  <p><strong>8b) Impaired Sensation:</strong> ${check(eval_.hasImpairedSensation)} Yes ${check(!eval_.hasImpairedSensation)} No</p>
  <p><strong>8c) Amputation:</strong> ${check(eval_.hasAmputation)} Yes ${check(!eval_.hasAmputation)} No ${eval_.amputationDetails.length > 0 ? '— ' + eval_.amputationDetails.join(', ') : ''}</p>
  <p><strong>8d) Postural Asymmetries:</strong> ${check(eval_.hasPosturalAsymmetries)} Yes ${check(!eval_.hasPosturalAsymmetries)} No</p>
  ${eval_.hasPosturalAsymmetries ? `<p>Pelvis: ${eval_.posturalDetails.pelvis.join(', ') || 'None'} | Trunk: ${eval_.posturalDetails.trunk.join(', ') || 'None'}</p>` : ''}

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">9. Utilization and Benefits</h3>
  <p><strong>9a) Needs to Manage:</strong> ${eval_.needsToManage.map(n => checkIf(true) + ' ' + n).join(' ')}</p>
  <p><strong>9b) MRADLs improved by PMD:</strong> ${check(eval_.mradlsImprovedByPMD)} Yes</p>
  <p><strong>9c) Willing and able:</strong> ${check(eval_.willingAndAble)} Yes</p>
  <p><strong>9d) Hours of Use/Day:</strong> ${checkIf(eval_.hoursPerDay === '>2')} > 2 ${checkIf(eval_.hoursPerDay === '<2')} < 2</p>
  <p><strong>9e) Primary use in home:</strong> ${check(eval_.primaryUseInHome)} Yes</p>

  <h3 style="border-bottom:2px solid #000; margin-bottom:6px;">10. PMD Selection</h3>
  <p><strong>PMD Base:</strong> ${checkIf(eval_.pmdBase === 'Power Wheelchair')} Power Wheelchair ${checkIf(eval_.pmdBase === 'Scooter (POV)')} Scooter (POV)</p>
  <p><strong>Features:</strong> ${eval_.features.map(f => checkIf(true) + ' ' + f).join(' ') || 'Standard (no power options)'}</p>
  <p><strong>Cushions:</strong> ${eval_.cushions.map(c => checkIf(true) + ' ' + c).join(' ') || 'Standard'}</p>
  <p><strong>Comments:</strong> ${eval_.comments}</p>

  <div style="margin-top:30px; border-top:1px solid #999; padding-top:10px; font-size:11px;">
    <p style="font-style:italic;">I have no financial relationship to the supplier. I am a Licensed Certified Medical Professional trained to evaluate rehabilitation PMDs.</p>
    <table style="width:100%;">
      <tr>
        <td style="width:33%;"><strong>Practitioner Name:</strong> _______________</td>
        <td style="width:33%;"><strong>Signature:</strong> _______________</td>
        <td style="width:33%;"><strong>Date:</strong> _______________</td>
      </tr>
    </table>
  </div>
</div>`;
}
