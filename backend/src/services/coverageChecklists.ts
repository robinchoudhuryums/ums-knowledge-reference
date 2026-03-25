/**
 * LCD Coverage Criteria Checklists — structured, per-item documentation
 * checklists derived from publicly available CMS Local Coverage Determinations.
 *
 * These static checklists are more reliable than RAG retrieval for ensuring
 * documentation completeness before claim submission.
 */

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  description: string;
  required: boolean;
  category: 'clinical' | 'documentation' | 'ordering' | 'supplier';
}

export interface CoverageChecklist {
  hcpcsCode: string;
  hcpcsDescription: string;
  lcdNumber: string;
  lcdTitle: string;
  checklist: ChecklistItem[];
  renewalChecklist?: ChecklistItem[];
  generalCriteria?: string[];
  frequencyLimitations?: string;
}

// ─── Static Checklists ─────────────────────────────────────────────────────────

const CHECKLISTS: CoverageChecklist[] = [
  // ── Home Oxygen (E0424-E0444) — LCD L33797 ────────────────────────────────
  {
    hcpcsCode: 'E0424-E0444',
    hcpcsDescription: 'Home Oxygen Equipment and Supplies',
    lcdNumber: 'L33797',
    lcdTitle: 'Oxygen and Oxygen Equipment',
    generalCriteria: [
      'Beneficiary must have a qualifying blood gas study performed under the treating physician\'s care.',
      'Testing must be performed while the beneficiary is in a chronic stable state (i.e., not during an acute illness or exacerbation).',
      'The qualifying test must be performed within 30 days prior to or on the date of the initial certification.',
    ],
    frequencyLimitations: 'Stationary oxygen equipment rental: per month. Portable oxygen equipment: per month. Contents/supplies billed per unit as applicable. Recertification required every 12 months.',
    checklist: [
      { id: 'oxy-01', description: 'Qualifying blood gas study (ABG or pulse oximetry) performed at rest, during exercise, or during sleep', required: true, category: 'clinical' },
      { id: 'oxy-02', description: 'SpO2 ≤ 88% or PaO2 ≤ 55 mmHg on room air at rest', required: true, category: 'clinical' },
      { id: 'oxy-03', description: 'OR SpO2 56-59% / PaO2 56-59 mmHg with dependent edema (cor pulmonale), erythrocytosis (hematocrit > 55%), or pulmonary hypertension', required: false, category: 'clinical' },
      { id: 'oxy-04', description: 'Testing performed on room air or at established liter flow rate', required: true, category: 'clinical' },
      { id: 'oxy-05', description: 'Face-to-face evaluation by treating physician within 30 days prior to the initial order', required: true, category: 'clinical' },
      { id: 'oxy-06', description: 'Physician order specifying liter flow rate, frequency of use, and duration of need', required: true, category: 'ordering' },
      { id: 'oxy-07', description: 'CMN (CMS-484) completed and signed by the treating physician', required: true, category: 'documentation' },
      { id: 'oxy-08', description: 'Diagnosis documented on claim and CMN (e.g., COPD, pulmonary fibrosis)', required: true, category: 'documentation' },
      { id: 'oxy-09', description: 'For portable oxygen: documented mobility-related need in the home', required: false, category: 'clinical' },
      { id: 'oxy-10', description: 'Supplier retains blood gas study results in file', required: true, category: 'supplier' },
      { id: 'oxy-11', description: 'Proof of delivery with beneficiary signature', required: true, category: 'supplier' },
    ],
    renewalChecklist: [
      { id: 'oxy-r01', description: 'Physician recertification of continued medical necessity', required: true, category: 'documentation' },
      { id: 'oxy-r02', description: 'Recertification completed within 90 days prior to the end of the current certification period', required: true, category: 'documentation' },
      { id: 'oxy-r03', description: 'For portable oxygen: retest performed within 365 days if qualifying test was during exercise or sleep', required: false, category: 'clinical' },
      { id: 'oxy-r04', description: 'Updated CMN (CMS-484) if required by payer', required: false, category: 'documentation' },
    ],
  },

  // ── CPAP (E0601) — LCD L33718 ─────────────────────────────────────────────
  {
    hcpcsCode: 'E0601',
    hcpcsDescription: 'Continuous Positive Airway Pressure (CPAP) Device',
    lcdNumber: 'L33718',
    lcdTitle: 'Positive Airway Pressure (PAP) Devices for the Treatment of Obstructive Sleep Apnea',
    generalCriteria: [
      'The beneficiary must have a diagnosis of obstructive sleep apnea (OSA).',
      'The diagnosis must be established through a qualifying sleep study.',
      'A face-to-face clinical evaluation must be performed by the treating physician prior to the sleep study.',
    ],
    frequencyLimitations: 'Initial rental period: 3 months. Continued coverage requires compliance and benefit documentation at 31-90 day requalification. After 13 months of continuous rental, equipment transfers to beneficiary ownership.',
    checklist: [
      { id: 'cpap-01', description: 'Sleep study (facility-based polysomnography or home sleep test) documenting AHI or RDI', required: true, category: 'clinical' },
      { id: 'cpap-02', description: 'AHI or RDI ≥ 15 events per hour', required: false, category: 'clinical' },
      { id: 'cpap-03', description: 'OR AHI or RDI ≥ 5 and ≤ 14 events per hour with documented symptoms (excessive daytime sleepiness, impaired cognition, mood disorders, insomnia, hypertension, ischemic heart disease, or history of stroke)', required: false, category: 'clinical' },
      { id: 'cpap-04', description: 'Face-to-face clinical evaluation by the treating physician prior to the sleep study', required: true, category: 'clinical' },
      { id: 'cpap-05', description: 'Physician order for CPAP with prescribed pressure setting', required: true, category: 'ordering' },
      { id: 'cpap-06', description: 'Sleep study interpreted by a physician board-certified in sleep medicine', required: true, category: 'clinical' },
      { id: 'cpap-07', description: '31-90 day compliance check: device usage ≥ 4 hours per night on 70% of nights during a consecutive 30-day period', required: true, category: 'documentation' },
      { id: 'cpap-08', description: 'Face-to-face clinical re-evaluation (between day 31 and day 91) documenting benefit from PAP therapy', required: true, category: 'clinical' },
      { id: 'cpap-09', description: 'Compliance download/report retained by supplier', required: true, category: 'supplier' },
      { id: 'cpap-10', description: 'Documentation that beneficiary was educated on proper use and care of device', required: true, category: 'supplier' },
    ],
    renewalChecklist: [
      { id: 'cpap-r01', description: 'Continued compliance demonstrated via device download', required: true, category: 'documentation' },
      { id: 'cpap-r02', description: 'Physician documentation of continued medical necessity and clinical benefit', required: true, category: 'documentation' },
    ],
  },

  // ── Hospital Beds (E0250-E0270) — LCD L33895 ─────────────────────────────
  {
    hcpcsCode: 'E0250-E0270',
    hcpcsDescription: 'Hospital Beds and Accessories',
    lcdNumber: 'L33895',
    lcdTitle: 'Hospital Beds and Accessories',
    generalCriteria: [
      'The beneficiary must have a medical condition that requires positioning that cannot be achieved in an ordinary bed.',
      'The item must be ordered by the treating physician based on a face-to-face evaluation.',
    ],
    frequencyLimitations: 'One hospital bed per beneficiary at a time. Rental per month. Replacement mattress/accessories as medically necessary.',
    checklist: [
      { id: 'bed-01', description: 'Medical condition documented that requires positioning not achievable with a standard bed', required: true, category: 'clinical' },
      { id: 'bed-02', description: 'Face-to-face evaluation documentation by treating physician', required: true, category: 'clinical' },
      { id: 'bed-03', description: 'Physician order specifying bed type (fixed height, semi-electric, or total electric)', required: true, category: 'ordering' },
      { id: 'bed-04', description: 'For semi-electric (E0260): documentation of need to change body position AND need for head of bed elevation', required: false, category: 'clinical' },
      { id: 'bed-05', description: 'For total electric (E0265/E0266): patient condition requires frequent changes in body position AND patient is unable to be repositioned by a caregiver AND patient is unable to operate manual bed controls', required: false, category: 'clinical' },
      { id: 'bed-06', description: 'For heavy-duty/extra-wide (E0301-E0304): documentation of patient weight exceeding standard bed capacity', required: false, category: 'clinical' },
      { id: 'bed-07', description: 'CMN (CMS-10126) completed if required by payer', required: false, category: 'documentation' },
      { id: 'bed-08', description: 'Documentation that bed will be used in the beneficiary\'s home', required: true, category: 'documentation' },
      { id: 'bed-09', description: 'Delivery confirmation signed by beneficiary or authorized representative', required: true, category: 'supplier' },
    ],
  },

  // ── Support Surfaces Group 1 (E0181-E0199) — LCD L33693 ──────────────────
  {
    hcpcsCode: 'E0181-E0199',
    hcpcsDescription: 'Pressure Reducing Support Surfaces — Group 1',
    lcdNumber: 'L33693',
    lcdTitle: 'Support Surfaces',
    generalCriteria: [
      'The beneficiary must have a documented pressure ulcer or be at high risk for pressure ulcer development.',
      'A comprehensive pressure ulcer prevention and treatment care plan must be in place.',
      'For powered surfaces, conservative treatment must have been tried and failed.',
    ],
    frequencyLimitations: 'One support surface per beneficiary at a time. Rental per month. Replacement pads/covers as needed based on wear.',
    checklist: [
      { id: 'surf-01', description: 'Pressure ulcer stage documented OR high-risk assessment completed (e.g., Braden Scale)', required: true, category: 'clinical' },
      { id: 'surf-02', description: 'Comprehensive wound/pressure ulcer care plan in place and documented in medical record', required: true, category: 'clinical' },
      { id: 'surf-03', description: 'For powered overlay/mattress (E0181/E0182): Stage II through Stage IV pressure ulcer documented AND patient has been on an appropriate static surface for at least one month without healing', required: false, category: 'clinical' },
      { id: 'surf-04', description: 'For Group 2 surfaces: multiple Stage II ulcers, large or multiple Stage III ulcers, or any Stage IV pressure ulcer', required: false, category: 'clinical' },
      { id: 'surf-05', description: 'Monthly wound assessments documented (size, depth, drainage, tissue type)', required: true, category: 'clinical' },
      { id: 'surf-06', description: 'Physician order specifying surface type', required: true, category: 'ordering' },
      { id: 'surf-07', description: 'Documentation of patient turning/repositioning schedule', required: true, category: 'documentation' },
      { id: 'surf-08', description: 'Documentation of nutritional assessment and interventions', required: false, category: 'documentation' },
      { id: 'surf-09', description: 'Documentation of moisture/incontinence management', required: false, category: 'documentation' },
      { id: 'surf-10', description: 'Supplier retains detailed product information and serial number', required: true, category: 'supplier' },
    ],
  },

  // ── Power Mobility Devices (K0813-K0899) — LCD L33789 ─────────────────────
  {
    hcpcsCode: 'K0813-K0899',
    hcpcsDescription: 'Power Mobility Devices (Power Wheelchairs and POVs)',
    lcdNumber: 'L33789',
    lcdTitle: 'Power Mobility Devices',
    generalCriteria: [
      'The beneficiary must have a mobility limitation that significantly impairs the ability to perform mobility-related activities of daily living (MRADLs) in the home.',
      'A face-to-face examination and a specialty evaluation are both required before the order is written.',
      'The mobility limitation cannot be resolved by a cane, walker, or manual wheelchair.',
    ],
    frequencyLimitations: 'One power mobility device per beneficiary every 5 years. Purchase only (no rental). Repair/replacement per Medicare guidelines.',
    checklist: [
      { id: 'pmd-01', description: 'Face-to-face mobility examination by the treating physician, physician assistant, or nurse practitioner', required: true, category: 'clinical' },
      { id: 'pmd-02', description: 'Mobility Assistive Equipment (MAE) specialty evaluation by a licensed/certified healthcare professional (PT, OT, or physician)', required: true, category: 'clinical' },
      { id: 'pmd-03', description: '7-element physician order (items, quantity, diagnosis, length of need, physician signature, date, NPI) written within 45 days after the face-to-face exam', required: true, category: 'ordering' },
      { id: 'pmd-04', description: 'Documentation of specific functional limitations in performing MRADLs in the home', required: true, category: 'clinical' },
      { id: 'pmd-05', description: 'Home assessment completed if environmental factors may affect device use', required: false, category: 'clinical' },
      { id: 'pmd-06', description: 'Evidence that a lesser mobility device (cane, walker, manual wheelchair) is insufficient or cannot be used', required: true, category: 'clinical' },
      { id: 'pmd-07', description: 'Documentation of beneficiary\'s ability to safely operate the power mobility device', required: true, category: 'clinical' },
      { id: 'pmd-08', description: 'Supporting medical records sent to supplier before or at time of delivery', required: true, category: 'documentation' },
      { id: 'pmd-09', description: 'Supplier retains copy of detailed product information (make, model, features)', required: true, category: 'supplier' },
      { id: 'pmd-10', description: 'Prior authorization obtained if required by MAC/payer', required: true, category: 'documentation' },
    ],
  },

  // ── Walkers (E0130-E0149) — LCD L33791 ────────────────────────────────────
  {
    hcpcsCode: 'E0130-E0149',
    hcpcsDescription: 'Walkers',
    lcdNumber: 'L33791',
    lcdTitle: 'Walking Aids and Accessories',
    generalCriteria: [
      'The beneficiary must have a mobility limitation that impairs safe ambulation.',
      'A walker must be necessary to assist with ambulation within the home.',
    ],
    frequencyLimitations: 'One walker per beneficiary every 5 years. Replacement accessories (tips, wheels, glides) as needed per wear.',
    checklist: [
      { id: 'walk-01', description: 'Documentation of mobility limitation that impairs safe ambulation in the home', required: true, category: 'clinical' },
      { id: 'walk-02', description: 'Physician order for walker specifying type', required: true, category: 'ordering' },
      { id: 'walk-03', description: 'For wheeled walker (E0141/E0143/E0149): documentation that a standard (non-wheeled) walker cannot be used due to the patient\'s condition', required: false, category: 'clinical' },
      { id: 'walk-04', description: 'For heavy-duty walker (E0148/E0149): documentation of patient weight exceeding standard walker capacity', required: false, category: 'clinical' },
      { id: 'walk-05', description: 'Face-to-face evaluation or clinical notes supporting medical necessity', required: true, category: 'clinical' },
      { id: 'walk-06', description: 'Delivery confirmation signed by beneficiary or authorized representative', required: true, category: 'supplier' },
    ],
  },

  // ── Enteral Nutrition (B4034-B4162) — LCD L33831 ──────────────────────────
  {
    hcpcsCode: 'B4034-B4162',
    hcpcsDescription: 'Enteral Nutrition Supplies and Formulae',
    lcdNumber: 'L33831',
    lcdTitle: 'Enteral Nutrition',
    generalCriteria: [
      'The beneficiary must have a functioning gastrointestinal (GI) tract.',
      'Enteral nutrition must be the sole or primary source of nutrition.',
      'The beneficiary must have a condition that prevents adequate oral intake.',
    ],
    frequencyLimitations: 'Monthly supply limits per caloric need and formula type. Pump and supply kits limited to one set per month. Enteral formula limited to documented caloric requirements.',
    checklist: [
      { id: 'ent-01', description: 'Documentation that caloric and nutrient needs cannot be met through oral intake alone', required: true, category: 'clinical' },
      { id: 'ent-02', description: 'Documentation of a functioning gastrointestinal (GI) tract', required: true, category: 'clinical' },
      { id: 'ent-03', description: 'Physician order specifying formula name/type, administration rate, frequency, and total daily caloric requirement', required: true, category: 'ordering' },
      { id: 'ent-04', description: 'Documentation of the route of administration (nasogastric, gastrostomy, jejunostomy)', required: true, category: 'clinical' },
      { id: 'ent-05', description: 'For prosthetic benefit: documentation that enteral nutrition is administered via a tube', required: true, category: 'documentation' },
      { id: 'ent-06', description: 'Monthly supply quantity within documented caloric need limits', required: true, category: 'supplier' },
      { id: 'ent-07', description: 'Diagnosis supporting enteral nutrition on file (e.g., dysphagia, head/neck cancer, neurological impairment)', required: true, category: 'documentation' },
    ],
    renewalChecklist: [
      { id: 'ent-r01', description: 'Physician recertification of continued need for enteral nutrition', required: true, category: 'documentation' },
      { id: 'ent-r02', description: 'Updated order if formula or rate has changed', required: false, category: 'ordering' },
    ],
  },

  // ── Pneumatic Compression Devices (E0650-E0676) — LCD L33829 ─────────────
  {
    hcpcsCode: 'E0650-E0676',
    hcpcsDescription: 'Pneumatic Compression Devices',
    lcdNumber: 'L33829',
    lcdTitle: 'Pneumatic Compression Devices',
    generalCriteria: [
      'The beneficiary must have a diagnosis of chronic venous insufficiency with venous stasis ulcers or lymphedema.',
      'Conservative therapy must have been tried and failed (or be contraindicated) before a pneumatic compression device is covered.',
    ],
    frequencyLimitations: 'One device (pump) per beneficiary. Replacement sleeves/garments based on wear (typically every 6 months). Purchase item.',
    checklist: [
      { id: 'pcd-01', description: 'Diagnosis of lymphedema or chronic venous insufficiency documented', required: true, category: 'clinical' },
      { id: 'pcd-02', description: 'Trial of conservative therapy completed: elevation, exercise, and compression garments used for a specified period before device is ordered', required: true, category: 'clinical' },
      { id: 'pcd-03', description: 'For venous insufficiency with ulcers: documentation that ulcer has not healed after a 6-month course of conservative therapy', required: false, category: 'clinical' },
      { id: 'pcd-04', description: 'For lymphedema: documentation of condition and prior treatment (e.g., Complete Decongestive Therapy)', required: false, category: 'clinical' },
      { id: 'pcd-05', description: 'Physician order for pneumatic compression device specifying type (segmented or non-segmented)', required: true, category: 'ordering' },
      { id: 'pcd-06', description: 'For segmented device (E0652/E0656/E0671-E0676): documentation that non-segmented device has failed or is not appropriate', required: false, category: 'clinical' },
      { id: 'pcd-07', description: 'Face-to-face evaluation or clinical notes supporting medical necessity', required: true, category: 'clinical' },
      { id: 'pcd-08', description: 'Documentation of extremity measurements for proper sizing', required: true, category: 'supplier' },
      { id: 'pcd-09', description: 'Delivery confirmation and patient education on device use', required: true, category: 'supplier' },
    ],
  },
];

// ─── HCPCS Range Helpers ───────────────────────────────────────────────────────

/**
 * Returns true if a single HCPCS code falls within a range like "E0424-E0444".
 */
function codeInRange(code: string, rangeStr: string): boolean {
  const upper = code.toUpperCase().trim();

  // Exact match (single code like "E0601")
  if (!rangeStr.includes('-')) {
    return upper === rangeStr.toUpperCase();
  }

  // Range match (e.g., "E0424-E0444")
  const parts = rangeStr.split('-').map(s => s.trim().toUpperCase());
  if (parts.length !== 2) return false;
  const [startStr, endStr] = parts;

  // The prefix letter must match
  const prefix = startStr.charAt(0);
  if (upper.charAt(0) !== prefix) return false;

  const codeNum = parseInt(upper.slice(1), 10);
  const startNum = parseInt(startStr.slice(1), 10);
  const endNum = parseInt(endStr.slice(1), 10);

  if (isNaN(codeNum) || isNaN(startNum) || isNaN(endNum)) return false;

  return codeNum >= startNum && codeNum <= endNum;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up a coverage checklist by HCPCS code. Supports both exact codes
 * (e.g. "E0601") and codes that fall within a range (e.g. "E0431").
 */
export function getChecklist(hcpcsCode: string): CoverageChecklist | undefined {
  const upper = hcpcsCode.toUpperCase().trim();

  for (const cl of CHECKLISTS) {
    if (cl.hcpcsCode.toUpperCase() === upper) return cl;
    if (codeInRange(upper, cl.hcpcsCode)) return cl;
  }

  return undefined;
}

/**
 * Free-text search across HCPCS codes, descriptions, LCD numbers, and titles.
 */
export function searchChecklists(query: string): CoverageChecklist[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  return CHECKLISTS.filter(cl =>
    cl.hcpcsCode.toLowerCase().includes(q) ||
    cl.hcpcsDescription.toLowerCase().includes(q) ||
    cl.lcdNumber.toLowerCase().includes(q) ||
    cl.lcdTitle.toLowerCase().includes(q)
  );
}

/**
 * Return a summary of all available checklists.
 */
export function listAvailableChecklists(): Array<{
  hcpcsCode: string;
  hcpcsDescription: string;
  lcdNumber: string;
  lcdTitle: string;
  itemCount: number;
}> {
  return CHECKLISTS.map(cl => ({
    hcpcsCode: cl.hcpcsCode,
    hcpcsDescription: cl.hcpcsDescription,
    lcdNumber: cl.lcdNumber,
    lcdTitle: cl.lcdTitle,
    itemCount: cl.checklist.length,
  }));
}

/**
 * Validate documentation completeness against a checklist.
 * Returns which required items are missing based on the set of completed item IDs.
 */
export function validateDocumentation(
  hcpcsCode: string,
  completedItems: string[],
): {
  complete: boolean;
  missing: ChecklistItem[];
  completedCount: number;
  totalRequired: number;
} | undefined {
  const cl = getChecklist(hcpcsCode);
  if (!cl) return undefined;

  const completedSet = new Set(completedItems.map(id => id.trim()));
  const requiredItems = cl.checklist.filter(item => item.required);
  const missing = requiredItems.filter(item => !completedSet.has(item.id));

  return {
    complete: missing.length === 0,
    missing,
    completedCount: requiredItems.length - missing.length,
    totalRequired: requiredItems.length,
  };
}
