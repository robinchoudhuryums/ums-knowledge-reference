export interface HcpcsCode {
  code: string;
  shortDescription: string;
  longDescription: string;
  category: string;
}

const HCPCS_DATABASE: HcpcsCode[] = [
  // Oxygen Equipment & Supplies
  { code: 'E0424', shortDescription: 'Stationary compressor', longDescription: 'Stationary compressed gaseous oxygen system, rental; includes compressor, all accessories, and supplies', category: 'Oxygen Equipment' },
  { code: 'E0431', shortDescription: 'Portable gaseous O2', longDescription: 'Portable gaseous oxygen system, rental; includes portable container, regulator, flowmeter, humidifier, cannula or mask, and tubing', category: 'Oxygen Equipment' },
  { code: 'E0434', shortDescription: 'Portable liquid O2', longDescription: 'Portable liquid oxygen system, rental; includes portable container, supply reservoir, humidifier, flowmeter, refill adaptor, contents gauge, cannula or mask, and tubing', category: 'Oxygen Equipment' },
  { code: 'E0439', shortDescription: 'Stationary liquid O2', longDescription: 'Stationary liquid oxygen system, rental; includes reservoir, contents indicator, regulator, flowmeter, humidifier, nebulizer, cannula or mask, and tubing', category: 'Oxygen Equipment' },
  { code: 'E0441', shortDescription: 'Stationary O2 contents, gaseous', longDescription: 'Stationary oxygen contents, gaseous, 1 month supply; includes cost of contents', category: 'Oxygen Equipment' },
  { code: 'E0442', shortDescription: 'Stationary O2 contents, liquid', longDescription: 'Stationary oxygen contents, liquid, 1 month supply; includes cost of contents', category: 'Oxygen Equipment' },
  { code: 'E0443', shortDescription: 'Portable O2 contents, gaseous', longDescription: 'Portable oxygen contents, gaseous, 1 month supply; includes cost of contents', category: 'Oxygen Equipment' },
  { code: 'E0444', shortDescription: 'Portable O2 contents, liquid', longDescription: 'Portable oxygen contents, liquid, 1 month supply; includes cost of contents', category: 'Oxygen Equipment' },
  { code: 'E1390', shortDescription: 'O2 concentrator', longDescription: 'Oxygen concentrator, single delivery port, capable of delivering 85 percent or greater oxygen concentration at the prescribed flow rate', category: 'Oxygen Equipment' },
  { code: 'E1391', shortDescription: 'O2 concentrator, dual port', longDescription: 'Oxygen concentrator, dual delivery port, capable of delivering 85 percent or greater oxygen concentration at the prescribed flow rate, each', category: 'Oxygen Equipment' },
  { code: 'E1392', shortDescription: 'Portable O2 concentrator', longDescription: 'Portable oxygen concentrator, rental', category: 'Oxygen Equipment' },

  // CPAP/BiPAP
  { code: 'E0601', shortDescription: 'CPAP device', longDescription: 'Continuous positive airway pressure (CPAP) device', category: 'CPAP/BiPAP' },
  { code: 'E0470', shortDescription: 'RAD without backup', longDescription: 'Respiratory assist device, bi-level pressure capability, without backup rate feature, used with noninvasive interface', category: 'CPAP/BiPAP' },
  { code: 'E0471', shortDescription: 'RAD with backup', longDescription: 'Respiratory assist device, bi-level pressure capability, with backup rate feature, used with noninvasive interface', category: 'CPAP/BiPAP' },
  { code: 'E0472', shortDescription: 'BiPAP without backup', longDescription: 'Respiratory assist device, bi-level pressure capability, without backup rate feature, used with invasive interface', category: 'CPAP/BiPAP' },

  // Hospital Beds
  { code: 'E0250', shortDescription: 'Hosp bed fixed ht w/o rails', longDescription: 'Hospital bed, fixed height, with any type side rails, without mattress', category: 'Hospital Beds' },
  { code: 'E0251', shortDescription: 'Hosp bed fixed ht w/ rails', longDescription: 'Hospital bed, fixed height, with any type side rails, with mattress', category: 'Hospital Beds' },
  { code: 'E0255', shortDescription: 'Hosp bed var ht w/o rails', longDescription: 'Hospital bed, variable height, hi-lo, with any type side rails, without mattress', category: 'Hospital Beds' },
  { code: 'E0256', shortDescription: 'Hosp bed var ht w/ rails', longDescription: 'Hospital bed, variable height, hi-lo, with any type side rails, with mattress', category: 'Hospital Beds' },
  { code: 'E0260', shortDescription: 'Semi-electric bed w/o rails', longDescription: 'Hospital bed, semi-electric (head and foot adjustment), with any type side rails, without mattress', category: 'Hospital Beds' },
  { code: 'E0261', shortDescription: 'Semi-electric bed w/ rails', longDescription: 'Hospital bed, semi-electric (head and foot adjustment), with any type side rails, with mattress', category: 'Hospital Beds' },
  { code: 'E0265', shortDescription: 'Total electric bed w/o rails', longDescription: 'Hospital bed, total electric (head, foot, and height adjustments), with any type side rails, without mattress', category: 'Hospital Beds' },
  { code: 'E0266', shortDescription: 'Total electric bed w/ rails', longDescription: 'Hospital bed, total electric (head, foot, and height adjustments), with any type side rails, with mattress', category: 'Hospital Beds' },
  { code: 'E0270', shortDescription: 'Hospital bed accessory', longDescription: 'Hospital bed accessory, any type, each', category: 'Hospital Beds' },
  { code: 'E0271', shortDescription: 'Mattress, innerspring', longDescription: 'Mattress, innerspring, for hospital bed', category: 'Hospital Beds' },
  { code: 'E0272', shortDescription: 'Mattress, foam rubber', longDescription: 'Mattress, foam rubber, for hospital bed', category: 'Hospital Beds' },
  { code: 'E0301', shortDescription: 'Hosp bed heavy duty', longDescription: 'Hospital bed, heavy duty, extra wide, with weight capacity greater than 350 pounds, but less than or equal to 600 pounds, with any type side rails, without mattress', category: 'Hospital Beds' },
  { code: 'E0302', shortDescription: 'Hosp bed extra heavy duty', longDescription: 'Hospital bed, extra heavy duty, extra wide, with weight capacity greater than 600 pounds, with any type side rails, without mattress', category: 'Hospital Beds' },
  { code: 'E0303', shortDescription: 'Hosp bed heavy duty x-wide', longDescription: 'Hospital bed, heavy duty, extra wide, with weight capacity greater than 350 pounds, but less than or equal to 600 pounds, with any type side rails, with mattress', category: 'Hospital Beds' },
  { code: 'E0304', shortDescription: 'Hosp bed x-heavy duty x-wide', longDescription: 'Hospital bed, extra heavy duty, extra wide, with weight capacity greater than 600 pounds, with any type side rails, with mattress', category: 'Hospital Beds' },

  // Manual Wheelchairs
  { code: 'K0001', shortDescription: 'Standard wheelchair', longDescription: 'Standard wheelchair', category: 'Manual Wheelchairs' },
  { code: 'K0002', shortDescription: 'Standard hemi wheelchair', longDescription: 'Standard hemi (low seat) wheelchair', category: 'Manual Wheelchairs' },
  { code: 'K0003', shortDescription: 'Lightweight wheelchair', longDescription: 'Lightweight wheelchair', category: 'Manual Wheelchairs' },
  { code: 'K0004', shortDescription: 'High strength lt wt wheelchair', longDescription: 'High strength, lightweight wheelchair', category: 'Manual Wheelchairs' },
  { code: 'K0005', shortDescription: 'Ultralightweight wheelchair', longDescription: 'Ultralightweight wheelchair', category: 'Manual Wheelchairs' },
  { code: 'K0006', shortDescription: 'Heavy duty wheelchair', longDescription: 'Heavy duty wheelchair', category: 'Manual Wheelchairs' },
  { code: 'K0007', shortDescription: 'Extra heavy duty wheelchair', longDescription: 'Extra heavy duty wheelchair', category: 'Manual Wheelchairs' },
  { code: 'K0009', shortDescription: 'Other manual wheelchair', longDescription: 'Other manual wheelchair/base', category: 'Manual Wheelchairs' },

  // Power Wheelchairs
  { code: 'K0813', shortDescription: 'PWC Grp 1 std captain seat', longDescription: 'Power wheelchair, group 1 standard, portable, sling/solid seat and back, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0814', shortDescription: 'PWC Grp 1 std sling seat', longDescription: 'Power wheelchair, group 1 standard, sling/solid seat and back, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0815', shortDescription: 'PWC Grp 1 portable', longDescription: 'Power wheelchair, group 1 standard, portable, sling/solid seat and back, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0816', shortDescription: 'PWC Grp 1 std tilt', longDescription: 'Power wheelchair, group 1 standard, sling/solid seat and back, patient weight capacity up to and including 300 pounds, with tilt', category: 'Power Wheelchairs' },
  { code: 'K0820', shortDescription: 'PWC Grp 2 std captain seat', longDescription: 'Power wheelchair, group 2 standard, portable, sling/solid seat/back, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0821', shortDescription: 'PWC Grp 2 std sling seat', longDescription: 'Power wheelchair, group 2 standard, sling/solid seat and back, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0822', shortDescription: 'PWC Grp 2 portable', longDescription: 'Power wheelchair, group 2 standard, portable, sling/solid seat and back, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0823', shortDescription: 'PWC Grp 2 HD captain seat', longDescription: 'Power wheelchair, group 2 heavy duty, sling/solid seat/back, patient weight capacity 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0824', shortDescription: 'PWC Grp 2 HD sling seat', longDescription: 'Power wheelchair, group 2 heavy duty, sling/solid seat and back, patient weight capacity 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0825', shortDescription: 'PWC Grp 2 very heavy duty', longDescription: 'Power wheelchair, group 2 very heavy duty, sling/solid seat/back, patient weight capacity 451 to 600 pounds', category: 'Power Wheelchairs' },

  // Walkers & Canes & Crutches
  { code: 'E0100', shortDescription: 'Cane, adjustable or fixed', longDescription: 'Cane, includes canes of all materials, adjustable or fixed, with tip', category: 'Walkers & Mobility Aids' },
  { code: 'E0105', shortDescription: 'Cane, quad or 3 prong', longDescription: 'Cane, quad or three prong, includes canes of all materials, adjustable or fixed, with tips', category: 'Walkers & Mobility Aids' },
  { code: 'E0110', shortDescription: 'Crutches forearm, each', longDescription: 'Crutches, forearm, includes crutches of various materials, adjustable or fixed, each, with tip and handgrips', category: 'Walkers & Mobility Aids' },
  { code: 'E0112', shortDescription: 'Crutches underarm wood, each', longDescription: 'Crutches, underarm, wood, adjustable or fixed, each, with pad, tip and handgrip', category: 'Walkers & Mobility Aids' },
  { code: 'E0113', shortDescription: 'Crutches underarm other, each', longDescription: 'Crutch, underarm, other than wood, adjustable or fixed, each, with pad, tip and handgrip', category: 'Walkers & Mobility Aids' },
  { code: 'E0114', shortDescription: 'Crutches forearm, pair', longDescription: 'Crutches, forearm, includes crutches of various materials, adjustable or fixed, pair, with tips and handgrips', category: 'Walkers & Mobility Aids' },
  { code: 'E0116', shortDescription: 'Crutches underarm wood, pair', longDescription: 'Crutches, underarm, wood, adjustable or fixed, pair, with pads, tips and handgrips', category: 'Walkers & Mobility Aids' },
  { code: 'E0117', shortDescription: 'Crutches underarm other, pair', longDescription: 'Crutches, underarm, other than wood, adjustable or fixed, pair, with pads, tips and handgrips', category: 'Walkers & Mobility Aids' },
  { code: 'E0130', shortDescription: 'Walker, rigid', longDescription: 'Walker, rigid (pickup), adjustable or fixed height', category: 'Walkers & Mobility Aids' },
  { code: 'E0135', shortDescription: 'Walker, folding', longDescription: 'Walker, folding (pickup), adjustable or fixed height', category: 'Walkers & Mobility Aids' },
  { code: 'E0141', shortDescription: 'Walker, rigid wheeled', longDescription: 'Walker, rigid, wheeled, adjustable or fixed height', category: 'Walkers & Mobility Aids' },
  { code: 'E0143', shortDescription: 'Walker, folding wheeled', longDescription: 'Walker, folding, wheeled, adjustable or fixed height', category: 'Walkers & Mobility Aids' },
  { code: 'E0147', shortDescription: 'Walker, heavy duty', longDescription: 'Walker, heavy duty, multiple braking system, variable wheel resistance', category: 'Walkers & Mobility Aids' },
  { code: 'E0148', shortDescription: 'Walker, heavy duty wheeled', longDescription: 'Walker, heavy duty, without wheels, rigid or folding, any type, each', category: 'Walkers & Mobility Aids' },
  { code: 'E0149', shortDescription: 'Walker, HD mult braking', longDescription: 'Walker, heavy duty, multiple braking system, variable wheel resistance, each', category: 'Walkers & Mobility Aids' },

  // Patient Lifts
  { code: 'E0621', shortDescription: 'Sling or seat, patient lift', longDescription: 'Sling or seat, patient lift, canvas or nylon', category: 'Patient Lifts' },
  { code: 'E0625', shortDescription: 'Patient lift, bathroom', longDescription: 'Patient lift, bathroom or toilet, not otherwise classified', category: 'Patient Lifts' },
  { code: 'E0627', shortDescription: 'Seat lift mechanism', longDescription: 'Seat lift mechanism incorporated into a combination lift-chair mechanism', category: 'Patient Lifts' },
  { code: 'E0630', shortDescription: 'Patient lift, hydraulic', longDescription: 'Patient lift, hydraulic or mechanical, includes any seat, sling, strap(s) or pad(s)', category: 'Patient Lifts' },
  { code: 'E0635', shortDescription: 'Patient lift, electric', longDescription: 'Patient lift, electric with seat or sling, patient weight capacity up to and including 300 pounds', category: 'Patient Lifts' },
  { code: 'E0636', shortDescription: 'Multi-position patient support', longDescription: 'Multipositional patient support system, with integrated lift, patient weight capacity up to and including 300 pounds, any type', category: 'Patient Lifts' },
  { code: 'E0637', shortDescription: 'Standing frame', longDescription: 'Combination sit to stand frame/table system, any size including pediatric, with seat lift feature, with or without wheels', category: 'Patient Lifts' },
  { code: 'E0638', shortDescription: 'Standing frame, mobile', longDescription: 'Standing frame/table system, one position (e.g., prone or supine), any size including pediatric, with or without wheels', category: 'Patient Lifts' },
  { code: 'E0639', shortDescription: 'Patient lift, heavy duty', longDescription: 'Patient lift, heavy duty, electric, with seat or sling, patient weight capacity greater than 300 pounds', category: 'Patient Lifts' },
  { code: 'E0640', shortDescription: 'Patient lift, fixed', longDescription: 'Patient lift, fixed (ceiling mounted), includes all components/accessories', category: 'Patient Lifts' },

  // Support Surfaces
  { code: 'E0181', shortDescription: 'Powered pressure mattress', longDescription: 'Powered pressure reducing mattress overlay/pad, alternating, with pump, includes heavy duty', category: 'Support Surfaces' },
  { code: 'E0184', shortDescription: 'Dry pressure mattress', longDescription: 'Dry pressure mattress', category: 'Support Surfaces' },
  { code: 'E0185', shortDescription: 'Gel pressure pad', longDescription: 'Gel or gel-like pressure pad for mattress, standard mattress length and width', category: 'Support Surfaces' },
  { code: 'E0186', shortDescription: 'Air pressure mattress', longDescription: 'Air pressure mattress', category: 'Support Surfaces' },
  { code: 'E0187', shortDescription: 'Water pressure mattress', longDescription: 'Water pressure mattress', category: 'Support Surfaces' },
  { code: 'E0193', shortDescription: 'Powered air flotation bed', longDescription: 'Powered air flotation bed (low air loss therapy)', category: 'Support Surfaces' },
  { code: 'E0196', shortDescription: 'Gel pressure mattress', longDescription: 'Gel pressure mattress', category: 'Support Surfaces' },
  { code: 'E0197', shortDescription: 'Air pressure pad, alternating', longDescription: 'Air pressure pad for mattress, alternating, with pump', category: 'Support Surfaces' },
  { code: 'E0198', shortDescription: 'Water pressure pad', longDescription: 'Water pressure pad for mattress, standard mattress length and width', category: 'Support Surfaces' },
  { code: 'E0199', shortDescription: 'Dry pressure pad', longDescription: 'Dry pressure pad for mattress, standard mattress length and width', category: 'Support Surfaces' },
  { code: 'E0277', shortDescription: 'Powered pressure-reducing air mattress', longDescription: 'Powered pressure-reducing air mattress overlay/pad, alternating, with pump, includes heavy duty', category: 'Support Surfaces' },

  // Enteral Nutrition
  { code: 'B4034', shortDescription: 'Enteral feeding kit, pump fed', longDescription: 'Enteral feeding supply kit; syringe fed, per day, includes but not limited to feeding/flushing syringe, administration set tubing, dressings, tape', category: 'Enteral Nutrition' },
  { code: 'B4035', shortDescription: 'Enteral feeding kit, gravity', longDescription: 'Enteral feeding supply kit; pump fed, per day, includes but not limited to feeding/flushing syringe, administration set tubing, dressings, tape', category: 'Enteral Nutrition' },
  { code: 'B4036', shortDescription: 'Enteral feeding kit, syringe', longDescription: 'Enteral feeding supply kit; gravity fed, per day, includes but not limited to feeding/flushing syringe, administration set tubing, dressings, tape', category: 'Enteral Nutrition' },
  { code: 'B4149', shortDescription: 'Enteral formula semi-synthetic', longDescription: 'Enteral formula, manufactured blenderized natural foods with intact nutrients, includes proteins, fats, carbohydrates, vitamins and minerals, may include fiber, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4150', shortDescription: 'Enteral formula complete', longDescription: 'Enteral formula, nutritionally complete with intact nutrients, includes proteins, fats, carbohydrates, vitamins and minerals, may include fiber, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4152', shortDescription: 'Enteral formula calorie dense', longDescription: 'Enteral formula, nutritionally complete, calorically dense (equal to or greater than 1.5 kcal/ml) with intact nutrients, includes proteins, fats, carbohydrates, vitamins and minerals, may include fiber, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4153', shortDescription: 'Enteral formula hydrolyzed', longDescription: 'Enteral formula, nutritionally complete, hydrolyzed proteins (amino acids and peptide chain), includes fats, carbohydrates, vitamins and minerals, may include fiber, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4154', shortDescription: 'Enteral formula specialty', longDescription: 'Enteral formula, nutritionally incomplete/modular nutrients, includes specific macronutrients, individual amino acids, or groups of amino acids, administered through an enteral feeding tube, per 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4155', shortDescription: 'Enteral formula disease specific', longDescription: 'Enteral formula, nutritionally complete, for special metabolic needs, excludes inherited disease of metabolism, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4157', shortDescription: 'Enteral formula standard', longDescription: 'Enteral formula, nutritionally complete, for special metabolic needs, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4158', shortDescription: 'Enteral formula intact nutrients', longDescription: 'Enteral formula, nutritionally complete, with intact nutrients, includes proteins, fats, carbohydrates, vitamins and minerals, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4159', shortDescription: 'Enteral formula renal', longDescription: 'Enteral formula, nutritionally complete, for renal patients, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4160', shortDescription: 'Enteral formula hepatic', longDescription: 'Enteral formula, nutritionally complete, for hepatic patients, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4161', shortDescription: 'Enteral formula glucose intol', longDescription: 'Enteral formula, nutritionally complete, for glucose intolerance patients, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B4162', shortDescription: 'Enteral formula protein', longDescription: 'Enteral formula, nutritionally complete, for critical care, administered through an enteral feeding tube, 100 calories = 1 unit', category: 'Enteral Nutrition' },
  { code: 'B9000', shortDescription: 'Enteral nutrition infusion pump', longDescription: 'Enteral nutrition infusion pump, without alarm', category: 'Enteral Nutrition' },
  { code: 'B9002', shortDescription: 'Enteral pump, portable', longDescription: 'Enteral nutrition infusion pump, portable, with alarm', category: 'Enteral Nutrition' },

  // Nebulizers
  { code: 'E0570', shortDescription: 'Nebulizer with compressor', longDescription: 'Nebulizer, with compressor', category: 'Nebulizers' },
  { code: 'E0572', shortDescription: 'Aerosol compressor', longDescription: 'Aerosol compressor, adjustable pressure, light duty for intermittent use', category: 'Nebulizers' },
  { code: 'E0574', shortDescription: 'Ultrasonic nebulizer', longDescription: 'Ultrasonic/electronic aerosol generator with small volume nebulizer', category: 'Nebulizers' },
  { code: 'E0575', shortDescription: 'Nebulizer, portable', longDescription: 'Nebulizer, portable, with built-in compressor', category: 'Nebulizers' },

  // Suction Equipment
  { code: 'E0600', shortDescription: 'Suction pump, respiratory', longDescription: 'Respiratory suction pump, home model, portable or stationary, electric', category: 'Suction Equipment' },

  // TENS Units
  { code: 'E0720', shortDescription: 'TENS, two lead', longDescription: 'Transcutaneous electrical nerve stimulation (TENS) device, two lead, localized stimulation', category: 'TENS Units' },
  { code: 'E0730', shortDescription: 'TENS, four lead', longDescription: 'Transcutaneous electrical nerve stimulation (TENS) device, four or more leads, for multiple nerve stimulation', category: 'TENS Units' },

  // Commodes
  { code: 'E0163', shortDescription: 'Commode chair, stationary', longDescription: 'Commode chair, mobile or stationary, with fixed arms', category: 'Commodes' },
  { code: 'E0165', shortDescription: 'Commode chair w/arms', longDescription: 'Commode chair, mobile or stationary, with detachable arms', category: 'Commodes' },
  { code: 'E0167', shortDescription: 'Commode chair, pail or pan', longDescription: 'Pail or pan for use with commode chair, replacement only, each', category: 'Commodes' },
  { code: 'E0168', shortDescription: 'Commode chair, extra wide', longDescription: 'Commode chair, extra wide and/or heavy duty, stationary or mobile, with or without arms, any type, each', category: 'Commodes' },
  { code: 'E0170', shortDescription: 'Commode chair, electric', longDescription: 'Commode chair with integrated seat lift mechanism, electric, any type', category: 'Commodes' },
  { code: 'E0171', shortDescription: 'Commode chair non-fold w/o wheels', longDescription: 'Commode chair, non-folding, extra wide and/or heavy duty, stationary, without wheels, with or without arms', category: 'Commodes' },

  // Bathroom Safety
  { code: 'E0240', shortDescription: 'Bath/shower chair', longDescription: 'Bath/shower chair, with or without wheels, any size', category: 'Bathroom Safety' },
  { code: 'E0241', shortDescription: 'Bath tub wall rail', longDescription: 'Bath tub wall rail, each', category: 'Bathroom Safety' },
  { code: 'E0242', shortDescription: 'Bath tub rail, floor base', longDescription: 'Bath tub rail, floor base', category: 'Bathroom Safety' },
  { code: 'E0243', shortDescription: 'Toilet rail', longDescription: 'Toilet rail, each', category: 'Bathroom Safety' },
  { code: 'E0244', shortDescription: 'Raised toilet seat', longDescription: 'Raised toilet seat', category: 'Bathroom Safety' },
  { code: 'E0245', shortDescription: 'Tub stool or bench', longDescription: 'Tub stool or bench', category: 'Bathroom Safety' },
  { code: 'E0246', shortDescription: 'Transfer tub rail', longDescription: 'Transfer tub rail attachment', category: 'Bathroom Safety' },
  { code: 'E0247', shortDescription: 'Transfer bench', longDescription: 'Transfer bench for tub or toilet with or without commode opening', category: 'Bathroom Safety' },
  { code: 'E0248', shortDescription: 'Transfer bench, heavy duty', longDescription: 'Transfer bench, heavy duty, for tub or toilet with or without commode opening', category: 'Bathroom Safety' },

  // Blood Glucose Monitors
  { code: 'E0607', shortDescription: 'Home blood glucose monitor', longDescription: 'Home blood glucose monitor', category: 'Blood Glucose Monitors' },
  { code: 'E2100', shortDescription: 'Blood glucose monitor w/ voice', longDescription: 'Blood glucose monitor with integrated voice synthesizer', category: 'Blood Glucose Monitors' },
  { code: 'E2101', shortDescription: 'Blood glucose monitor special', longDescription: 'Blood glucose monitor with integrated lancing/blood sample', category: 'Blood Glucose Monitors' },

  // Infusion Pumps
  { code: 'E0781', shortDescription: 'Ambulatory infusion pump, mech', longDescription: 'Ambulatory infusion pump, mechanical, reusable, for infusion 8 hours or greater', category: 'Infusion Pumps' },
  { code: 'E0783', shortDescription: 'Infusion pump, stationary', longDescription: 'Infusion pump, stationary, programmable', category: 'Infusion Pumps' },
  { code: 'E0784', shortDescription: 'External infusion pump, insulin', longDescription: 'External ambulatory infusion pump, insulin', category: 'Infusion Pumps' },
  { code: 'E0791', shortDescription: 'Parenteral infusion pump', longDescription: 'Parenteral infusion pump, stationary, single or multi-channel', category: 'Infusion Pumps' },

  // Pneumatic Compressors
  { code: 'E0650', shortDescription: 'Pneumatic compressor, non-seg', longDescription: 'Pneumatic compressor, non-segmental home model', category: 'Pneumatic Compressors' },
  { code: 'E0651', shortDescription: 'Pneumatic compressor, segmented', longDescription: 'Pneumatic compressor, segmental home model without calibrated gradient pressure', category: 'Pneumatic Compressors' },
  { code: 'E0652', shortDescription: 'Pneumatic compressor, seg cal', longDescription: 'Pneumatic compressor, segmental home model with calibrated gradient pressure', category: 'Pneumatic Compressors' },
  { code: 'E0655', shortDescription: 'Non-seg pneumatic, half arm', longDescription: 'Non-segmental pneumatic appliance for use with pneumatic compressor, half arm', category: 'Pneumatic Compressors' },
  { code: 'E0656', shortDescription: 'Seg pneumatic, full leg', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, full leg', category: 'Pneumatic Compressors' },
  { code: 'E0657', shortDescription: 'Seg pneumatic, full arm', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, full arm', category: 'Pneumatic Compressors' },
  { code: 'E0660', shortDescription: 'Non-seg pneumatic, full leg', longDescription: 'Non-segmental pneumatic appliance for use with pneumatic compressor, full leg', category: 'Pneumatic Compressors' },
  { code: 'E0665', shortDescription: 'Non-seg pneumatic, full arm', longDescription: 'Non-segmental pneumatic appliance for use with pneumatic compressor, full arm', category: 'Pneumatic Compressors' },
  { code: 'E0666', shortDescription: 'Non-seg pneumatic, half leg', longDescription: 'Non-segmental pneumatic appliance for use with pneumatic compressor, half leg', category: 'Pneumatic Compressors' },
  { code: 'E0667', shortDescription: 'Seg pneumatic, full leg', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, full leg', category: 'Pneumatic Compressors' },
  { code: 'E0668', shortDescription: 'Seg pneumatic, full arm', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, full arm', category: 'Pneumatic Compressors' },
  { code: 'E0669', shortDescription: 'Seg pneumatic, half leg', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, half leg', category: 'Pneumatic Compressors' },
  { code: 'E0670', shortDescription: 'Seg cal gradient, full leg', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, with calibrated gradient pressure, full leg', category: 'Pneumatic Compressors' },
  { code: 'E0671', shortDescription: 'Seg cal gradient, full arm', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, with calibrated gradient pressure, full arm', category: 'Pneumatic Compressors' },
  { code: 'E0672', shortDescription: 'Seg cal gradient, half leg', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, with calibrated gradient pressure, half leg', category: 'Pneumatic Compressors' },
  { code: 'E0673', shortDescription: 'Seg pneumatic, chest', longDescription: 'Segmental pneumatic appliance for use with pneumatic compressor, chest', category: 'Pneumatic Compressors' },
  { code: 'E0675', shortDescription: 'Pneumatic device NOS', longDescription: 'Pneumatic compression device, high pressure, rapid inflation/deflation cycle, for use on trunk', category: 'Pneumatic Compressors' },
  { code: 'E0676', shortDescription: 'Intermittent limb compression', longDescription: 'Intermittent limb compression device (includes all accessories), not otherwise specified', category: 'Pneumatic Compressors' },
];

/**
 * Search HCPCS codes by partial code or description keywords.
 * Returns up to 50 matches sorted by relevance (code match first, then description).
 */
export function searchHcpcs(query: string): HcpcsCode[] {
  if (!query || !query.trim()) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();
  const queryTerms = normalizedQuery.split(/\s+/);

  const scored: Array<{ entry: HcpcsCode; score: number }> = [];

  for (const entry of HCPCS_DATABASE) {
    let score = 0;
    const codeLower = entry.code.toLowerCase();
    const shortLower = entry.shortDescription.toLowerCase();
    const longLower = entry.longDescription.toLowerCase();
    const categoryLower = entry.category.toLowerCase();

    // Exact code match gets highest priority
    if (codeLower === normalizedQuery) {
      score += 100;
    } else if (codeLower.startsWith(normalizedQuery)) {
      score += 50;
    } else if (codeLower.includes(normalizedQuery)) {
      score += 30;
    }

    // Check each query term against descriptions
    for (const term of queryTerms) {
      if (shortLower.includes(term)) {
        score += 10;
      }
      if (longLower.includes(term)) {
        score += 5;
      }
      if (categoryLower.includes(term)) {
        score += 3;
      }
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 50).map((s) => s.entry);
}

/**
 * Look up a single HCPCS code by exact code (case-insensitive).
 */
export function getHcpcsCode(code: string): HcpcsCode | undefined {
  if (!code || !code.trim()) {
    return undefined;
  }
  const normalizedCode = code.trim().toUpperCase();
  return HCPCS_DATABASE.find((entry) => entry.code === normalizedCode);
}

/**
 * Get all HCPCS codes in a given category (case-insensitive partial match).
 */
export function getHcpcsByCategory(category: string): HcpcsCode[] {
  if (!category || !category.trim()) {
    return [];
  }
  const normalizedCategory = category.trim().toLowerCase();
  return HCPCS_DATABASE.filter((entry) =>
    entry.category.toLowerCase().includes(normalizedCategory)
  );
}

/**
 * List all unique categories, sorted alphabetically.
 */
export function listCategories(): string[] {
  const categories = new Set<string>();
  for (const entry of HCPCS_DATABASE) {
    categories.add(entry.category);
  }
  return Array.from(categories).sort();
}
