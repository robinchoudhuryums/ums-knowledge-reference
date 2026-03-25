/**
 * ICD-10 to HCPCS Crosswalk Service
 *
 * Maps diagnosis codes to DME equipment they justify, and vice versa.
 * Static lookup table of the most common DME-relevant ICD-10 codes.
 */

export interface Icd10Code {
  code: string;
  description: string;
  category: string;
}

export interface CoverageMapping {
  icd10Code: string;
  hcpcsCode: string;
  hcpcsDescription: string;
  coverageNotes?: string;
  documentationRequired?: string;
}

const ICD10_CODES: Icd10Code[] = [
  // COPD / Chronic Respiratory
  { code: 'J44.0', description: 'COPD with acute lower respiratory infection', category: 'COPD/Chronic Respiratory' },
  { code: 'J44.1', description: 'COPD with acute exacerbation', category: 'COPD/Chronic Respiratory' },
  { code: 'J44.9', description: 'COPD, unspecified', category: 'COPD/Chronic Respiratory' },
  { code: 'J43.9', description: 'Emphysema, unspecified', category: 'COPD/Chronic Respiratory' },
  { code: 'J84.10', description: 'Pulmonary fibrosis, unspecified', category: 'COPD/Chronic Respiratory' },
  { code: 'J84.9', description: 'Interstitial pulmonary disease, unspecified', category: 'COPD/Chronic Respiratory' },
  { code: 'J98.4', description: 'Other disorders of lung', category: 'COPD/Chronic Respiratory' },

  // Acute Respiratory Failure
  { code: 'J96.00', description: 'Acute respiratory failure, unspecified whether with hypoxia or hypercapnia', category: 'Respiratory Failure' },
  { code: 'J96.01', description: 'Acute respiratory failure with hypoxia', category: 'Respiratory Failure' },
  { code: 'J96.10', description: 'Chronic respiratory failure, unspecified whether with hypoxia or hypercapnia', category: 'Respiratory Failure' },
  { code: 'J96.11', description: 'Chronic respiratory failure with hypoxia', category: 'Respiratory Failure' },
  { code: 'J96.90', description: 'Respiratory failure, unspecified', category: 'Respiratory Failure' },

  // Sleep Disorders
  { code: 'G47.30', description: 'Sleep apnea, unspecified', category: 'Sleep Disorders' },
  { code: 'G47.31', description: 'Primary central sleep apnea', category: 'Sleep Disorders' },
  { code: 'G47.33', description: 'Obstructive sleep apnea (adult)(pediatric)', category: 'Sleep Disorders' },
  { code: 'G47.39', description: 'Other sleep apnea', category: 'Sleep Disorders' },

  // Heart Failure
  { code: 'I50.20', description: 'Unspecified systolic (congestive) heart failure', category: 'Heart Failure' },
  { code: 'I50.22', description: 'Chronic systolic (congestive) heart failure', category: 'Heart Failure' },
  { code: 'I50.30', description: 'Unspecified diastolic (congestive) heart failure', category: 'Heart Failure' },
  { code: 'I50.32', description: 'Chronic diastolic (congestive) heart failure', category: 'Heart Failure' },
  { code: 'I50.9', description: 'Heart failure, unspecified', category: 'Heart Failure' },

  // Neuromuscular
  { code: 'G80.9', description: 'Cerebral palsy, unspecified', category: 'Neuromuscular' },
  { code: 'G12.21', description: 'Amyotrophic lateral sclerosis', category: 'Neuromuscular' },
  { code: 'G71.0', description: 'Muscular dystrophy', category: 'Neuromuscular' },
  { code: 'G35', description: 'Multiple sclerosis', category: 'Neuromuscular' },
  { code: 'G20', description: 'Parkinson\'s disease', category: 'Neuromuscular' },

  // Spinal / Mobility
  { code: 'G82.20', description: 'Paraplegia, unspecified', category: 'Spinal/Mobility' },
  { code: 'G82.50', description: 'Quadriplegia, unspecified', category: 'Spinal/Mobility' },
  { code: 'M62.81', description: 'Muscle weakness (generalized)', category: 'Spinal/Mobility' },
  { code: 'Z74.09', description: 'Other reduced mobility', category: 'Spinal/Mobility' },
  { code: 'Z74.1', description: 'Need for assistance with personal care', category: 'Spinal/Mobility' },

  // Pressure Ulcers
  { code: 'L89.010', description: 'Pressure ulcer of elbow, unstageable', category: 'Pressure Ulcers' },
  { code: 'L89.012', description: 'Pressure ulcer of right elbow, stage 2', category: 'Pressure Ulcers' },
  { code: 'L89.013', description: 'Pressure ulcer of right elbow, stage 3', category: 'Pressure Ulcers' },
  { code: 'L89.014', description: 'Pressure ulcer of right elbow, stage 4', category: 'Pressure Ulcers' },
  { code: 'L89.110', description: 'Pressure ulcer of right upper back, unstageable', category: 'Pressure Ulcers' },
  { code: 'L89.130', description: 'Pressure ulcer of right lower back, unstageable', category: 'Pressure Ulcers' },
  { code: 'L89.150', description: 'Pressure ulcer of sacral region, unstageable', category: 'Pressure Ulcers' },
  { code: 'L89.152', description: 'Pressure ulcer of sacral region, stage 2', category: 'Pressure Ulcers' },
  { code: 'L89.153', description: 'Pressure ulcer of sacral region, stage 3', category: 'Pressure Ulcers' },
  { code: 'L89.154', description: 'Pressure ulcer of sacral region, stage 4', category: 'Pressure Ulcers' },
  { code: 'L89.210', description: 'Pressure ulcer of right hip, unstageable', category: 'Pressure Ulcers' },
  { code: 'L89.310', description: 'Pressure ulcer of right buttock, unstageable', category: 'Pressure Ulcers' },

  // Diabetes
  { code: 'E11.65', description: 'Type 2 diabetes mellitus with hyperglycemia', category: 'Diabetes' },
  { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', category: 'Diabetes' },
  { code: 'E10.65', description: 'Type 1 diabetes mellitus with hyperglycemia', category: 'Diabetes' },
  { code: 'E10.9', description: 'Type 1 diabetes mellitus without complications', category: 'Diabetes' },

  // Obesity
  { code: 'E66.01', description: 'Morbid (severe) obesity due to excess calories', category: 'Obesity' },
  { code: 'E66.09', description: 'Other obesity due to excess calories', category: 'Obesity' },
  { code: 'E66.9', description: 'Obesity, unspecified', category: 'Obesity' },

  // Joint / Arthritis
  { code: 'M17.11', description: 'Primary osteoarthritis, right knee', category: 'Joint/Arthritis' },
  { code: 'M17.12', description: 'Primary osteoarthritis, left knee', category: 'Joint/Arthritis' },
  { code: 'M17.9', description: 'Osteoarthritis of knee, unspecified', category: 'Joint/Arthritis' },
  { code: 'M19.90', description: 'Unspecified osteoarthritis, unspecified site', category: 'Joint/Arthritis' },

  // Lymphedema / Venous
  { code: 'I89.0', description: 'Lymphedema, not elsewhere classified', category: 'Lymphedema/Venous' },
  { code: 'I87.2', description: 'Venous insufficiency (chronic)(peripheral)', category: 'Lymphedema/Venous' },
  { code: 'Q82.0', description: 'Hereditary lymphedema', category: 'Lymphedema/Venous' },

  // Pain
  { code: 'G89.29', description: 'Other chronic pain', category: 'Pain' },
  { code: 'G89.4', description: 'Chronic pain syndrome', category: 'Pain' },
  { code: 'M54.5', description: 'Low back pain', category: 'Pain' },
  { code: 'M54.16', description: 'Radiculopathy, lumbar region', category: 'Pain' },

  // Dysphagia / Nutrition
  { code: 'R13.10', description: 'Dysphagia, unspecified', category: 'Dysphagia/Nutrition' },
  { code: 'R13.19', description: 'Other dysphagia', category: 'Dysphagia/Nutrition' },
  { code: 'K90.0', description: 'Celiac disease', category: 'Dysphagia/Nutrition' },
  { code: 'K90.9', description: 'Intestinal malabsorption, unspecified', category: 'Dysphagia/Nutrition' },
];

const COVERAGE_MAPPINGS: CoverageMapping[] = [
  // COPD → Oxygen, Nebulizers
  { icd10Code: 'J44.0', hcpcsCode: 'E0424', hcpcsDescription: 'Stationary compressed gaseous O2 system', coverageNotes: 'Qualifying blood gas required', documentationRequired: 'CMN CMS-484, ABG/oximetry results' },
  { icd10Code: 'J44.0', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Most common home O2 delivery', documentationRequired: 'CMN CMS-484, ABG/oximetry results' },
  { icd10Code: 'J44.0', hcpcsCode: 'E0570', hcpcsDescription: 'Nebulizer with compressor', coverageNotes: 'For aerosolized medication delivery', documentationRequired: 'Physician order with medication' },
  { icd10Code: 'J44.1', hcpcsCode: 'E0424', hcpcsDescription: 'Stationary compressed gaseous O2 system', coverageNotes: 'Qualifying blood gas required', documentationRequired: 'CMN CMS-484, ABG/oximetry results' },
  { icd10Code: 'J44.1', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Most common home O2 delivery', documentationRequired: 'CMN CMS-484, ABG/oximetry results' },
  { icd10Code: 'J44.1', hcpcsCode: 'E0570', hcpcsDescription: 'Nebulizer with compressor', coverageNotes: 'For aerosolized medication delivery', documentationRequired: 'Physician order with medication' },
  { icd10Code: 'J44.9', hcpcsCode: 'E0424', hcpcsDescription: 'Stationary compressed gaseous O2 system', coverageNotes: 'Qualifying blood gas required', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'J44.9', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Most common home O2 delivery', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'J44.9', hcpcsCode: 'E0570', hcpcsDescription: 'Nebulizer with compressor' },
  { icd10Code: 'J43.9', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Qualifying blood gas required', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'J43.9', hcpcsCode: 'E0570', hcpcsDescription: 'Nebulizer with compressor' },
  { icd10Code: 'J84.10', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Qualifying blood gas required', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'J84.9', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', documentationRequired: 'CMN CMS-484' },

  // Respiratory Failure → Oxygen, BiPAP
  { icd10Code: 'J96.00', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Acute respiratory failure — document transition to chronic need', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'J96.01', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Hypoxic respiratory failure', documentationRequired: 'CMN CMS-484, ABG results' },
  { icd10Code: 'J96.01', hcpcsCode: 'E0470', hcpcsDescription: 'RAD without backup rate', coverageNotes: 'For respiratory failure with hypoxia requiring ventilatory support' },
  { icd10Code: 'J96.10', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'J96.11', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'J96.11', hcpcsCode: 'E0471', hcpcsDescription: 'RAD with backup rate', coverageNotes: 'For chronic respiratory failure requiring backup rate' },
  { icd10Code: 'J96.90', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', documentationRequired: 'CMN CMS-484' },

  // Sleep Apnea → CPAP, BiPAP
  { icd10Code: 'G47.33', hcpcsCode: 'E0601', hcpcsDescription: 'CPAP device', coverageNotes: 'AHI ≥ 5 with symptoms or AHI ≥ 15', documentationRequired: 'Sleep study, face-to-face eval, 31-90 day compliance' },
  { icd10Code: 'G47.33', hcpcsCode: 'E0470', hcpcsDescription: 'RAD without backup rate (BiPAP)', coverageNotes: 'When CPAP is ineffective or not tolerated', documentationRequired: 'Sleep study, CPAP trial documentation' },
  { icd10Code: 'G47.30', hcpcsCode: 'E0601', hcpcsDescription: 'CPAP device', coverageNotes: 'Requires qualifying sleep study', documentationRequired: 'PSG or HST results' },
  { icd10Code: 'G47.31', hcpcsCode: 'E0471', hcpcsDescription: 'RAD with backup rate', coverageNotes: 'Central sleep apnea may require backup rate', documentationRequired: 'Sleep study documenting central events' },
  { icd10Code: 'G47.39', hcpcsCode: 'E0601', hcpcsDescription: 'CPAP device', documentationRequired: 'Sleep study results' },
  { icd10Code: 'G47.39', hcpcsCode: 'E0470', hcpcsDescription: 'RAD without backup rate', coverageNotes: 'For complex sleep apnea' },

  // Heart Failure → Oxygen
  { icd10Code: 'I50.20', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Qualifying blood gas + cor pulmonale/edema documentation', documentationRequired: 'CMN CMS-484, SpO2/PaO2 + edema evidence' },
  { icd10Code: 'I50.22', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', coverageNotes: 'Chronic HF with documented hypoxemia', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'I50.30', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'I50.32', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', documentationRequired: 'CMN CMS-484' },
  { icd10Code: 'I50.9', hcpcsCode: 'E1390', hcpcsDescription: 'Oxygen concentrator', documentationRequired: 'CMN CMS-484' },

  // Neuromuscular → Power wheelchairs, Hospital beds, Respiratory
  { icd10Code: 'G12.21', hcpcsCode: 'K0823', hcpcsDescription: 'PWC Group 2 heavy duty, captain seat', coverageNotes: 'ALS — progressive mobility loss', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order' },
  { icd10Code: 'G12.21', hcpcsCode: 'E0260', hcpcsDescription: 'Hospital bed, semi-electric', coverageNotes: 'For positioning needs due to ALS', documentationRequired: 'Physician order, functional limitation documentation' },
  { icd10Code: 'G12.21', hcpcsCode: 'E0471', hcpcsDescription: 'RAD with backup rate', coverageNotes: 'ALS with respiratory muscle weakness', documentationRequired: 'PFT results, physician order' },
  { icd10Code: 'G71.0', hcpcsCode: 'K0823', hcpcsDescription: 'PWC Group 2 heavy duty, captain seat', coverageNotes: 'Muscular dystrophy — progressive', documentationRequired: 'Face-to-face mobility exam, MAE evaluation' },
  { icd10Code: 'G71.0', hcpcsCode: 'E0260', hcpcsDescription: 'Hospital bed, semi-electric', documentationRequired: 'Physician order, positioning needs documentation' },
  { icd10Code: 'G35', hcpcsCode: 'K0823', hcpcsDescription: 'PWC Group 2 heavy duty, captain seat', coverageNotes: 'When lesser mobility device insufficient', documentationRequired: 'Face-to-face mobility exam, MAE evaluation' },
  { icd10Code: 'G35', hcpcsCode: 'K0003', hcpcsDescription: 'Lightweight wheelchair', coverageNotes: 'For ambulatory MS patients with fatigue', documentationRequired: 'Physician order, mobility limitation documentation' },
  { icd10Code: 'G35', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', documentationRequired: 'Physician order' },
  { icd10Code: 'G20', hcpcsCode: 'K0001', hcpcsDescription: 'Standard wheelchair', coverageNotes: 'For Parkinson\'s patients with gait impairment', documentationRequired: 'Physician order, mobility limitation documentation' },
  { icd10Code: 'G20', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', documentationRequired: 'Physician order' },
  { icd10Code: 'G80.9', hcpcsCode: 'K0823', hcpcsDescription: 'PWC Group 2 heavy duty, captain seat', documentationRequired: 'Face-to-face mobility exam, MAE evaluation' },
  { icd10Code: 'G80.9', hcpcsCode: 'E0260', hcpcsDescription: 'Hospital bed, semi-electric', documentationRequired: 'Physician order' },

  // Neuromuscular/Spinal → Group 3+ Power Wheelchairs (multiple power options, tilt/recline)
  { icd10Code: 'G12.21', hcpcsCode: 'K0861', hcpcsDescription: 'PWC Group 3 std, multiple power, captain', coverageNotes: 'ALS — Group 3 when tilt/recline/seat elevation needed', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order, justification for Group 3 features' },
  { icd10Code: 'G12.21', hcpcsCode: 'K0860', hcpcsDescription: 'PWC Group 3 std, multiple power, sling', coverageNotes: 'ALS — Group 3 when multiple power options required', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order' },
  { icd10Code: 'G71.0', hcpcsCode: 'K0861', hcpcsDescription: 'PWC Group 3 std, multiple power, captain', coverageNotes: 'Muscular dystrophy — Group 3 for tilt/recline', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order' },
  { icd10Code: 'G82.50', hcpcsCode: 'K0861', hcpcsDescription: 'PWC Group 3 std, multiple power, captain', coverageNotes: 'Quadriplegia — Group 3 for pressure relief and positioning', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order' },
  { icd10Code: 'G82.50', hcpcsCode: 'K0868', hcpcsDescription: 'PWC Group 4 std, sling seat', coverageNotes: 'Quadriplegia — Group 4 when specialty controls needed', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, specialty eval, 7-element order' },
  { icd10Code: 'G82.20', hcpcsCode: 'K0861', hcpcsDescription: 'PWC Group 3 std, multiple power, captain', coverageNotes: 'Paraplegia — Group 3 when tilt/recline needed for pressure management', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order' },
  { icd10Code: 'G80.9', hcpcsCode: 'K0861', hcpcsDescription: 'PWC Group 3 std, multiple power, captain', coverageNotes: 'Cerebral palsy — Group 3 for positioning', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order' },
  { icd10Code: 'G35', hcpcsCode: 'K0861', hcpcsDescription: 'PWC Group 3 std, multiple power, captain', coverageNotes: 'MS — Group 3 when progressive weakness requires tilt/recline', documentationRequired: 'Face-to-face mobility exam, MAE evaluation, 7-element order' },

  // Spinal / Mobility → Wheelchairs, Walkers, Beds
  { icd10Code: 'G82.20', hcpcsCode: 'K0005', hcpcsDescription: 'Ultralightweight wheelchair', coverageNotes: 'Paraplegia — upper body strength for self-propulsion', documentationRequired: 'Face-to-face mobility exam' },
  { icd10Code: 'G82.20', hcpcsCode: 'E0260', hcpcsDescription: 'Hospital bed, semi-electric', documentationRequired: 'Physician order, positioning needs' },
  { icd10Code: 'G82.50', hcpcsCode: 'K0823', hcpcsDescription: 'PWC Group 2 heavy duty, captain seat', coverageNotes: 'Quadriplegia — unable to self-propel manual chair', documentationRequired: 'Face-to-face mobility exam, MAE evaluation' },
  { icd10Code: 'G82.50', hcpcsCode: 'E0265', hcpcsDescription: 'Hospital bed, total electric', coverageNotes: 'Patient unable to operate manual bed controls', documentationRequired: 'Physician order' },
  { icd10Code: 'M62.81', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', coverageNotes: 'Generalized weakness affecting ambulation', documentationRequired: 'Physician order' },
  { icd10Code: 'M62.81', hcpcsCode: 'K0001', hcpcsDescription: 'Standard wheelchair', coverageNotes: 'When walking aid is insufficient', documentationRequired: 'Physician order, mobility limitation documentation' },
  { icd10Code: 'Z74.09', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', documentationRequired: 'Physician order' },
  { icd10Code: 'Z74.09', hcpcsCode: 'K0001', hcpcsDescription: 'Standard wheelchair', documentationRequired: 'Physician order' },

  // Pressure Ulcers → Support Surfaces, Hospital Beds
  { icd10Code: 'L89.152', hcpcsCode: 'E0184', hcpcsDescription: 'Dry pressure mattress', coverageNotes: 'Stage 2 pressure ulcer — Group 1 surface', documentationRequired: 'Wound assessment, care plan documentation' },
  { icd10Code: 'L89.153', hcpcsCode: 'E0277', hcpcsDescription: 'Powered pressure-reducing air mattress', coverageNotes: 'Stage 3 — Group 2 surface if not improving on Group 1', documentationRequired: 'Monthly wound assessments, failed Group 1 documentation' },
  { icd10Code: 'L89.153', hcpcsCode: 'E0260', hcpcsDescription: 'Hospital bed, semi-electric', coverageNotes: 'For positioning to relieve pressure', documentationRequired: 'Physician order' },
  { icd10Code: 'L89.154', hcpcsCode: 'E0277', hcpcsDescription: 'Powered pressure-reducing air mattress', coverageNotes: 'Stage 4 — Group 2 surface required', documentationRequired: 'Monthly wound assessments, comprehensive care plan' },
  { icd10Code: 'L89.154', hcpcsCode: 'E0193', hcpcsDescription: 'Powered air flotation bed', coverageNotes: 'Stage 4 — Group 3 if Group 2 failed', documentationRequired: 'Failed Group 2 documentation, wound assessments' },
  { icd10Code: 'L89.154', hcpcsCode: 'E0260', hcpcsDescription: 'Hospital bed, semi-electric', documentationRequired: 'Physician order' },
  { icd10Code: 'L89.012', hcpcsCode: 'E0184', hcpcsDescription: 'Dry pressure mattress', documentationRequired: 'Wound assessment' },
  { icd10Code: 'L89.013', hcpcsCode: 'E0277', hcpcsDescription: 'Powered pressure-reducing air mattress', documentationRequired: 'Wound assessment, care plan' },
  { icd10Code: 'L89.014', hcpcsCode: 'E0277', hcpcsDescription: 'Powered pressure-reducing air mattress', documentationRequired: 'Wound assessment, care plan' },
  { icd10Code: 'L89.150', hcpcsCode: 'E0184', hcpcsDescription: 'Dry pressure mattress', documentationRequired: 'Wound assessment' },
  { icd10Code: 'L89.210', hcpcsCode: 'E0184', hcpcsDescription: 'Dry pressure mattress', documentationRequired: 'Wound assessment' },
  { icd10Code: 'L89.310', hcpcsCode: 'E0184', hcpcsDescription: 'Dry pressure mattress', documentationRequired: 'Wound assessment' },

  // Diabetes → Glucose Monitors, Insulin Pumps
  { icd10Code: 'E11.65', hcpcsCode: 'E0607', hcpcsDescription: 'Home blood glucose monitor', coverageNotes: 'Type 2 with hyperglycemia', documentationRequired: 'Physician order, treatment plan' },
  { icd10Code: 'E11.9', hcpcsCode: 'E0607', hcpcsDescription: 'Home blood glucose monitor', documentationRequired: 'Physician order' },
  { icd10Code: 'E10.65', hcpcsCode: 'E0607', hcpcsDescription: 'Home blood glucose monitor', documentationRequired: 'Physician order' },
  { icd10Code: 'E10.65', hcpcsCode: 'E0784', hcpcsDescription: 'External ambulatory infusion pump, insulin', coverageNotes: 'Type 1 requiring insulin pump therapy', documentationRequired: 'Physician order, pump management training, C-peptide/fasting glucose' },
  { icd10Code: 'E10.9', hcpcsCode: 'E0607', hcpcsDescription: 'Home blood glucose monitor', documentationRequired: 'Physician order' },
  { icd10Code: 'E10.9', hcpcsCode: 'E0784', hcpcsDescription: 'External ambulatory infusion pump, insulin', documentationRequired: 'Physician order, C-peptide results' },

  // Obesity → Bariatric/Heavy Duty Equipment
  { icd10Code: 'E66.01', hcpcsCode: 'K0006', hcpcsDescription: 'Heavy duty wheelchair', coverageNotes: 'Morbid obesity requiring heavy duty equipment', documentationRequired: 'Physician order, weight documentation' },
  { icd10Code: 'E66.01', hcpcsCode: 'K0007', hcpcsDescription: 'Extra heavy duty wheelchair', coverageNotes: 'For patients exceeding heavy duty weight limit', documentationRequired: 'Physician order, weight documentation' },
  { icd10Code: 'E66.01', hcpcsCode: 'E0301', hcpcsDescription: 'Hospital bed, heavy duty', coverageNotes: 'Standard bed weight capacity insufficient', documentationRequired: 'Physician order, weight documentation' },
  { icd10Code: 'E66.01', hcpcsCode: 'E0302', hcpcsDescription: 'Hospital bed, extra heavy duty', documentationRequired: 'Physician order, weight documentation' },
  { icd10Code: 'E66.09', hcpcsCode: 'K0006', hcpcsDescription: 'Heavy duty wheelchair', documentationRequired: 'Physician order, weight documentation' },
  { icd10Code: 'E66.09', hcpcsCode: 'E0301', hcpcsDescription: 'Hospital bed, heavy duty', documentationRequired: 'Physician order' },

  // Joint / Arthritis → Walking Aids
  { icd10Code: 'M17.11', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', coverageNotes: 'OA affecting ambulation', documentationRequired: 'Physician order' },
  { icd10Code: 'M17.11', hcpcsCode: 'E0105', hcpcsDescription: 'Cane, quad or three prong', documentationRequired: 'Physician order' },
  { icd10Code: 'M17.12', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', documentationRequired: 'Physician order' },
  { icd10Code: 'M17.9', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', documentationRequired: 'Physician order' },
  { icd10Code: 'M19.90', hcpcsCode: 'E0143', hcpcsDescription: 'Walker, folding, wheeled', documentationRequired: 'Physician order' },
  { icd10Code: 'M19.90', hcpcsCode: 'E0100', hcpcsDescription: 'Cane, adjustable or fixed', documentationRequired: 'Physician order' },

  // Lymphedema → Pneumatic Compressors
  { icd10Code: 'I89.0', hcpcsCode: 'E0651', hcpcsDescription: 'Pneumatic compressor, segmented', coverageNotes: 'After failed conservative therapy trial', documentationRequired: 'Limb measurements, conservative therapy documentation, physician order' },
  { icd10Code: 'I89.0', hcpcsCode: 'E0650', hcpcsDescription: 'Pneumatic compressor, non-segmented', coverageNotes: 'Initial trial before segmented device', documentationRequired: 'Limb measurements, physician order' },
  { icd10Code: 'I87.2', hcpcsCode: 'E0651', hcpcsDescription: 'Pneumatic compressor, segmented', coverageNotes: 'Chronic venous insufficiency with documented edema', documentationRequired: 'Limb measurements, conservative therapy documentation' },
  { icd10Code: 'I87.2', hcpcsCode: 'E0650', hcpcsDescription: 'Pneumatic compressor, non-segmented', documentationRequired: 'Limb measurements, physician order' },
  { icd10Code: 'Q82.0', hcpcsCode: 'E0651', hcpcsDescription: 'Pneumatic compressor, segmented', documentationRequired: 'Limb measurements, physician order' },

  // Pain → TENS
  { icd10Code: 'G89.29', hcpcsCode: 'E0720', hcpcsDescription: 'TENS device, two lead', coverageNotes: 'Chronic pain — document failed conservative measures', documentationRequired: 'Physician order, pain assessment, trial period documentation' },
  { icd10Code: 'G89.29', hcpcsCode: 'E0730', hcpcsDescription: 'TENS device, four or more leads', documentationRequired: 'Physician order, pain assessment' },
  { icd10Code: 'G89.4', hcpcsCode: 'E0720', hcpcsDescription: 'TENS device, two lead', documentationRequired: 'Physician order, pain assessment' },
  { icd10Code: 'M54.5', hcpcsCode: 'E0720', hcpcsDescription: 'TENS device, two lead', coverageNotes: 'Low back pain — trial period required', documentationRequired: 'Physician order, trial period results' },
  { icd10Code: 'M54.16', hcpcsCode: 'E0720', hcpcsDescription: 'TENS device, two lead', documentationRequired: 'Physician order' },

  // Dysphagia / Nutrition → Enteral
  { icd10Code: 'R13.10', hcpcsCode: 'B4150', hcpcsDescription: 'Enteral formula, complete nutrition', coverageNotes: 'Oral intake insufficient to meet caloric needs', documentationRequired: 'Physician order with formula, rate, frequency; caloric needs documentation' },
  { icd10Code: 'R13.10', hcpcsCode: 'B9000', hcpcsDescription: 'Enteral nutrition infusion pump, stationary', documentationRequired: 'Physician order' },
  { icd10Code: 'R13.19', hcpcsCode: 'B4150', hcpcsDescription: 'Enteral formula, complete nutrition', documentationRequired: 'Physician order, caloric needs documentation' },
  { icd10Code: 'K90.0', hcpcsCode: 'B4153', hcpcsDescription: 'Enteral formula, hydrolyzed proteins', coverageNotes: 'Celiac disease — specialized formula may be required', documentationRequired: 'Physician order, nutritional assessment' },
  { icd10Code: 'K90.9', hcpcsCode: 'B4150', hcpcsDescription: 'Enteral formula, complete nutrition', documentationRequired: 'Physician order, malabsorption documentation' },
];

/**
 * Get HCPCS codes justified by an ICD-10 diagnosis code.
 * Supports partial code matching (e.g., "J44" matches J44.0, J44.1, J44.9).
 */
export function getHcpcsForDiagnosis(icd10Code: string): CoverageMapping[] {
  const normalized = icd10Code.toUpperCase().trim();
  return COVERAGE_MAPPINGS.filter(m =>
    m.icd10Code.toUpperCase().startsWith(normalized) ||
    normalized.startsWith(m.icd10Code.toUpperCase())
  );
}

/**
 * Reverse lookup: get ICD-10 diagnosis codes that justify a given HCPCS code.
 */
export function getDiagnosesForHcpcs(hcpcsCode: string): CoverageMapping[] {
  const normalized = hcpcsCode.toUpperCase().trim();
  return COVERAGE_MAPPINGS.filter(m => m.hcpcsCode.toUpperCase() === normalized);
}

/**
 * Search ICD-10 codes by code prefix or description keywords.
 */
export function searchDiagnoses(query: string): Icd10Code[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  return ICD10_CODES.filter(code => {
    if (code.code.toLowerCase().startsWith(q)) return true;
    const words = q.split(/\s+/);
    const desc = code.description.toLowerCase();
    const cat = code.category.toLowerCase();
    return words.every(w => desc.includes(w) || cat.includes(w));
  }).slice(0, 50);
}

/**
 * List all unique ICD-10 categories, sorted alphabetically.
 */
export function listIcd10Categories(): string[] {
  return [...new Set(ICD10_CODES.map(c => c.category))].sort();
}
