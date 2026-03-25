// LCD Coverage Criteria Checklists for DME Suppliers

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

export const CHECKLISTS: CoverageChecklist[] = [
  // ─── Home Oxygen (E0424, LCD L33797) ───
  {
    hcpcsCode: 'E0424',
    hcpcsDescription: 'Stationary compressed gaseous oxygen system, rental',
    lcdNumber: 'L33797',
    lcdTitle: 'Oxygen and Oxygen Equipment',
    checklist: [
      {
        id: 'E0424-001',
        description: 'Qualifying blood gas study (ABG or pulse oximetry) performed at rest, during exercise, or during sleep',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0424-002',
        description: 'SpO2 ≤ 88% or PaO2 ≤ 55mmHg, or SpO2 89%/PaO2 56-59 with dependent edema, cor pulmonale, or erythrocytosis (hematocrit > 55%)',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0424-003',
        description: 'Testing performed while breathing room air, or on prescribed liter flow for portable',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0424-004',
        description: 'Face-to-face evaluation within 30 days prior to initial date of service',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0424-005',
        description: 'Physician order specifying liter flow rate, frequency of use, and duration',
        required: true,
        category: 'ordering',
      },
      {
        id: 'E0424-006',
        description: 'CMN (CMS-484) completed and signed by treating physician',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0424-007',
        description: 'Supplier has proof of delivery with beneficiary signature',
        required: true,
        category: 'supplier',
      },
      {
        id: 'E0424-008',
        description: 'Clinical notes supporting medical necessity',
        required: false,
        category: 'documentation',
      },
    ],
    renewalChecklist: [
      {
        id: 'E0424-R001',
        description: 'Recertification within 90 days of expiration',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0424-R002',
        description: 'Retest within 365 days for portable oxygen',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0424-R003',
        description: 'Updated CMN for renewal period',
        required: true,
        category: 'documentation',
      },
    ],
  },

  // ─── CPAP (E0601, LCD L33718) ───
  {
    hcpcsCode: 'E0601',
    hcpcsDescription: 'Continuous positive airway pressure (CPAP) device',
    lcdNumber: 'L33718',
    lcdTitle: 'Positive Airway Pressure (PAP) Devices and Accessories',
    checklist: [
      {
        id: 'E0601-001',
        description: 'Diagnostic sleep study (in-lab PSG or home sleep test) documenting AHI/RDI',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0601-002',
        description: 'AHI ≥ 5 with documented symptoms (excessive daytime sleepiness, impaired cognition, mood disorders, insomnia, hypertension, ischemic heart disease, stroke) OR AHI ≥ 15 regardless of symptoms',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0601-003',
        description: 'Face-to-face clinical evaluation by treating physician prior to sleep study',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0601-004',
        description: 'Written physician order prior to delivery',
        required: true,
        category: 'ordering',
      },
      {
        id: 'E0601-005',
        description: 'Compliance check between days 31-90: usage ≥ 4 hours/night on ≥ 70% of nights in consecutive 30-day period',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0601-006',
        description: 'Documentation of clinical benefit at compliance check',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0601-007',
        description: 'Proof of delivery with beneficiary signature',
        required: true,
        category: 'supplier',
      },
    ],
  },

  // ─── Hospital Beds (E0260, LCD L33895) ───
  {
    hcpcsCode: 'E0260',
    hcpcsDescription: 'Hospital bed, semi-electric (head and foot adjustment), with mattress',
    lcdNumber: 'L33895',
    lcdTitle: 'Hospital Beds and Accessories',
    checklist: [
      {
        id: 'E0260-001',
        description: 'Medical condition requiring specific body positioning not achievable with ordinary bed',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0260-002',
        description: 'For semi-electric: patient requires both change of body position AND elevation of head',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0260-003',
        description: 'For total electric: patient requires frequent changes AND is unable to operate manual controls',
        required: false,
        category: 'clinical',
      },
      {
        id: 'E0260-004',
        description: 'Face-to-face evaluation documentation supporting medical necessity',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0260-005',
        description: 'Physician order specifying bed type (fixed, semi-electric, total electric)',
        required: true,
        category: 'ordering',
      },
      {
        id: 'E0260-006',
        description: 'CMN (CMS-10126) if applicable',
        required: false,
        category: 'documentation',
      },
    ],
    generalCriteria: [
      'Patient must be confined to bed',
      'Condition must require positioning features',
      'Recliner or adjustable frame does not meet criteria',
    ],
  },

  // ─── Support Surfaces Group 1 (E0184, LCD L33693) ───
  {
    hcpcsCode: 'E0184',
    hcpcsDescription: 'Dry pressure mattress pad, alternating pressure, powered',
    lcdNumber: 'L33693',
    lcdTitle: 'Support Surfaces',
    checklist: [
      {
        id: 'E0184-001',
        description: 'Documentation of pressure ulcer presence and stage, or high-risk assessment',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0184-002',
        description: 'Comprehensive pressure ulcer care plan already in place (turning/repositioning, nutrition, moisture management)',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0184-003',
        description: 'For powered surfaces: Stage II or greater pressure ulcer that has not improved over past month on appropriate non-powered surface',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0184-004',
        description: 'Monthly wound assessment documentation',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0184-005',
        description: 'Physician order with specific product type',
        required: true,
        category: 'ordering',
      },
      {
        id: 'E0184-006',
        description: 'Proof of delivery',
        required: true,
        category: 'supplier',
      },
    ],
  },

  // ─── Power Mobility Devices (K0823, LCD L33789) ───
  {
    hcpcsCode: 'K0823',
    hcpcsDescription: 'Power wheelchair, Group 2 standard, captain chair, patient weight capacity up to 300 lbs',
    lcdNumber: 'L33789',
    lcdTitle: 'Power Mobility Devices',
    checklist: [
      {
        id: 'K0823-001',
        description: 'Face-to-face mobility examination by treating physician, PA, or NP',
        required: true,
        category: 'clinical',
      },
      {
        id: 'K0823-002',
        description: 'Mobility limitation significantly impairs performance of MRADLs (mobility-related activities of daily living) in the home',
        required: true,
        category: 'clinical',
      },
      {
        id: 'K0823-003',
        description: 'Mobility Assistive Equipment (MAE) clinical evaluation',
        required: true,
        category: 'documentation',
      },
      {
        id: 'K0823-004',
        description: '7-element physician order with signature within 45 days of face-to-face exam',
        required: true,
        category: 'ordering',
      },
      {
        id: 'K0823-005',
        description: 'Documentation that a lesser mobility device (cane, walker, manual wheelchair) has been considered and ruled out',
        required: true,
        category: 'documentation',
      },
      {
        id: 'K0823-006',
        description: 'Home assessment if appropriate use in home is in question',
        required: false,
        category: 'documentation',
      },
      {
        id: 'K0823-007',
        description: 'Proof of delivery and beneficiary training',
        required: true,
        category: 'supplier',
      },
    ],
  },

  // ─── Walkers (E0143, LCD L33791) ───
  {
    hcpcsCode: 'E0143',
    hcpcsDescription: 'Walker, folding, wheeled, adjustable or fixed height',
    lcdNumber: 'L33791',
    lcdTitle: 'Walking Aids and Accessories',
    checklist: [
      {
        id: 'E0143-001',
        description: 'Mobility limitation that impairs safe ambulation',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0143-002',
        description: 'Physician order specifying walker type',
        required: true,
        category: 'ordering',
      },
      {
        id: 'E0143-003',
        description: 'For wheeled walker: documentation that patient cannot use standard rigid walker',
        required: false,
        category: 'clinical',
      },
      {
        id: 'E0143-004',
        description: 'Proof of delivery',
        required: true,
        category: 'supplier',
      },
    ],
  },

  // ─── Enteral Nutrition (B4150, LCD L33831) ───
  {
    hcpcsCode: 'B4150',
    hcpcsDescription: 'Enteral formula, nutritionally complete with intact nutrients, includes proteins, fats, carbohydrates, vitamins and minerals, may include fiber, per 100 calories',
    lcdNumber: 'L33831',
    lcdTitle: 'Enteral Nutrition',
    checklist: [
      {
        id: 'B4150-001',
        description: 'Documentation that caloric/nutrient needs cannot be met through oral feeding alone',
        required: true,
        category: 'clinical',
      },
      {
        id: 'B4150-002',
        description: 'Functioning gastrointestinal tract capable of absorbing nutrients',
        required: true,
        category: 'clinical',
      },
      {
        id: 'B4150-003',
        description: 'Physician order specifying formula type, administration rate, and frequency',
        required: true,
        category: 'ordering',
      },
      {
        id: 'B4150-004',
        description: 'Documentation of specific caloric requirements and how determined',
        required: true,
        category: 'documentation',
      },
      {
        id: 'B4150-005',
        description: 'Monthly documentation of continued medical necessity',
        required: true,
        category: 'documentation',
      },
      {
        id: 'B4150-006',
        description: 'Proof of delivery with supply quantity documentation',
        required: true,
        category: 'supplier',
      },
    ],
    frequencyLimitations: 'Standard monthly supply limits per CMS; additional units require documentation',
  },

  // ─── Pneumatic Compression Devices (E0651, LCD L33829) ───
  {
    hcpcsCode: 'E0651',
    hcpcsDescription: 'Pneumatic compressor, segmented, with calibrated gradient pressure',
    lcdNumber: 'L33829',
    lcdTitle: 'Pneumatic Compression Devices',
    checklist: [
      {
        id: 'E0651-001',
        description: 'Diagnosis of lymphedema or chronic venous insufficiency with documented measurements',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0651-002',
        description: 'Trial of conservative therapy (compression garments, elevation, exercise) for adequate period before device',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0651-003',
        description: 'For segmented device: non-segmented device was tried and failed or is medically inappropriate',
        required: true,
        category: 'clinical',
      },
      {
        id: 'E0651-004',
        description: 'Physician order specifying device type and treatment parameters',
        required: true,
        category: 'ordering',
      },
      {
        id: 'E0651-005',
        description: 'Documentation of objective limb measurements before and during treatment',
        required: true,
        category: 'documentation',
      },
      {
        id: 'E0651-006',
        description: 'Proof of delivery and patient training',
        required: true,
        category: 'supplier',
      },
    ],
  },
];

/**
 * Look up a coverage checklist by HCPCS code.
 * Tries an exact match first, then checks if the query matches any checklist entry.
 */
export function getChecklist(hcpcsCode: string): CoverageChecklist | undefined {
  const normalized = hcpcsCode.trim().toUpperCase();
  return CHECKLISTS.find((c) => c.hcpcsCode === normalized);
}

/**
 * Search checklists by HCPCS code, description, or LCD number.
 */
export function searchChecklists(query: string): CoverageChecklist[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return CHECKLISTS.filter((c) => {
    return (
      c.hcpcsCode.toLowerCase().includes(q) ||
      c.hcpcsDescription.toLowerCase().includes(q) ||
      c.lcdNumber.toLowerCase().includes(q) ||
      c.lcdTitle.toLowerCase().includes(q)
    );
  });
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
  return CHECKLISTS.map((c) => ({
    hcpcsCode: c.hcpcsCode,
    hcpcsDescription: c.hcpcsDescription,
    lcdNumber: c.lcdNumber,
    lcdTitle: c.lcdTitle,
    itemCount: c.checklist.length,
  }));
}

/**
 * Validate documentation against a checklist.
 * Returns which required items are missing based on the set of completed item IDs.
 */
export function validateDocumentation(
  hcpcsCode: string,
  completedItems: string[]
): { complete: boolean; missing: ChecklistItem[]; completedCount: number; totalRequired: number } | undefined {
  const checklist = getChecklist(hcpcsCode);
  if (!checklist) return undefined;

  const completedSet = new Set(completedItems);
  const requiredItems = checklist.checklist.filter((item) => item.required);
  const missing = requiredItems.filter((item) => !completedSet.has(item.id));

  return {
    complete: missing.length === 0,
    missing,
    completedCount: requiredItems.length - missing.length,
    totalRequired: requiredItems.length,
  };
}
