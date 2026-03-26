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
  { code: 'K0826', shortDescription: 'PWC Grp 2 very HD captain', longDescription: 'Power wheelchair, group 2 very heavy duty, captain chair, patient weight capacity 451 to 600 pounds', category: 'Power Wheelchairs' },
  { code: 'K0827', shortDescription: 'PWC Grp 2 std seat elevator sling', longDescription: 'Power wheelchair, group 2 standard, seat elevator, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0828', shortDescription: 'PWC Grp 2 std seat elevator captain', longDescription: 'Power wheelchair, group 2 standard, seat elevator, captain chair, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0829', shortDescription: 'PWC Grp 2 std tilt sling', longDescription: 'Power wheelchair, group 2 standard, power tilt only, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0830', shortDescription: 'PWC Grp 2 std tilt captain', longDescription: 'Power wheelchair, group 2 standard, power tilt only, captain chair, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0831', shortDescription: 'PWC Grp 2 std recline sling', longDescription: 'Power wheelchair, group 2 standard, power recline only, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0835', shortDescription: 'PWC Grp 2 std tilt and recline sling', longDescription: 'Power wheelchair, group 2 standard, power tilt and recline, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0836', shortDescription: 'PWC Grp 2 std tilt and recline captain', longDescription: 'Power wheelchair, group 2 standard, power tilt and recline, captain chair, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0837', shortDescription: 'PWC Grp 2 HD tilt sling', longDescription: 'Power wheelchair, group 2 heavy duty, power tilt only, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0838', shortDescription: 'PWC Grp 2 HD recline sling', longDescription: 'Power wheelchair, group 2 heavy duty, power recline only, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0839', shortDescription: 'PWC Grp 2 HD tilt and recline sling', longDescription: 'Power wheelchair, group 2 heavy duty, power tilt and recline, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0840', shortDescription: 'PWC Grp 2 extra HD tilt sling', longDescription: 'Power wheelchair, group 2 extra heavy duty, power tilt only, sling/solid seat/back, patient weight 451 to 600 pounds', category: 'Power Wheelchairs' },
  { code: 'K0841', shortDescription: 'PWC Grp 2 std power legs sling', longDescription: 'Power wheelchair, group 2 standard, power elevating leg rests, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0842', shortDescription: 'PWC Grp 2 HD power legs sling', longDescription: 'Power wheelchair, group 2 heavy duty, power elevating leg rests, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0843', shortDescription: 'PWC Grp 2 std standing sling', longDescription: 'Power wheelchair, group 2 standard, power standing feature, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0848', shortDescription: 'PWC Grp 3 std sling seat', longDescription: 'Power wheelchair, group 3 standard, sling/solid seat/back, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0849', shortDescription: 'PWC Grp 3 std captain seat', longDescription: 'Power wheelchair, group 3 standard, captain chair, patient weight capacity up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0850', shortDescription: 'PWC Grp 3 HD sling seat', longDescription: 'Power wheelchair, group 3 heavy duty, sling/solid seat/back, patient weight capacity 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0851', shortDescription: 'PWC Grp 3 HD captain seat', longDescription: 'Power wheelchair, group 3 heavy duty, captain chair, patient weight capacity 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0852', shortDescription: 'PWC Grp 3 very heavy duty', longDescription: 'Power wheelchair, group 3 very heavy duty, sling/solid seat/back, patient weight capacity 451 to 600 pounds', category: 'Power Wheelchairs' },
  { code: 'K0853', shortDescription: 'PWC Grp 3 very heavy duty captain', longDescription: 'Power wheelchair, group 3 very heavy duty, captain chair, patient weight capacity 451 to 600 pounds', category: 'Power Wheelchairs' },
  { code: 'K0854', shortDescription: 'PWC Grp 3 extra heavy duty', longDescription: 'Power wheelchair, group 3 extra heavy duty, sling/solid seat/back, patient weight capacity 601 pounds or more', category: 'Power Wheelchairs' },
  { code: 'K0855', shortDescription: 'PWC Grp 3 extra heavy duty captain', longDescription: 'Power wheelchair, group 3 extra heavy duty, captain chair, patient weight capacity 601 pounds or more', category: 'Power Wheelchairs' },
  { code: 'K0856', shortDescription: 'PWC Grp 3 std single power', longDescription: 'Power wheelchair, group 3 standard, single power option, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0857', shortDescription: 'PWC Grp 3 std single power captain', longDescription: 'Power wheelchair, group 3 standard, single power option, captain chair, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0858', shortDescription: 'PWC Grp 3 HD single power', longDescription: 'Power wheelchair, group 3 heavy duty, single power option, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0859', shortDescription: 'PWC Grp 3 HD single power captain', longDescription: 'Power wheelchair, group 3 heavy duty, single power option, captain chair, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0860', shortDescription: 'PWC Grp 3 std multiple power', longDescription: 'Power wheelchair, group 3 standard, multiple power option, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0861', shortDescription: 'PWC Grp 3 std multiple power captain', longDescription: 'Power wheelchair, group 3 standard, multiple power option, captain chair, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0862', shortDescription: 'PWC Grp 3 HD multiple power', longDescription: 'Power wheelchair, group 3 heavy duty, multiple power option, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0863', shortDescription: 'PWC Grp 3 HD multiple power captain', longDescription: 'Power wheelchair, group 3 heavy duty, multiple power option, captain chair, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0864', shortDescription: 'PWC Grp 3 very HD multiple power', longDescription: 'Power wheelchair, group 3 very heavy duty, multiple power option, sling/solid seat/back, patient weight 451 to 600 pounds', category: 'Power Wheelchairs' },
  { code: 'K0868', shortDescription: 'PWC Grp 4 std sling seat', longDescription: 'Power wheelchair, group 4 standard, sling/solid seat/back, patient weight up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0869', shortDescription: 'PWC Grp 4 std captain seat', longDescription: 'Power wheelchair, group 4 standard, captain chair, patient weight up to and including 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0870', shortDescription: 'PWC Grp 4 HD sling seat', longDescription: 'Power wheelchair, group 4 heavy duty, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0871', shortDescription: 'PWC Grp 4 very heavy duty', longDescription: 'Power wheelchair, group 4 very heavy duty, sling/solid seat/back, patient weight 451 to 600 pounds', category: 'Power Wheelchairs' },
  { code: 'K0877', shortDescription: 'PWC Grp 4 std single power', longDescription: 'Power wheelchair, group 4 standard, single power option, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0878', shortDescription: 'PWC Grp 4 std single power captain', longDescription: 'Power wheelchair, group 4 standard, single power option, captain chair, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0879', shortDescription: 'PWC Grp 4 HD single power', longDescription: 'Power wheelchair, group 4 heavy duty, single power option, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0880', shortDescription: 'PWC Grp 4 std multiple power', longDescription: 'Power wheelchair, group 4 standard, multiple power option, sling/solid seat/back, patient weight up to 300 pounds', category: 'Power Wheelchairs' },
  { code: 'K0884', shortDescription: 'PWC Grp 4 HD multiple power', longDescription: 'Power wheelchair, group 4 heavy duty, multiple power option, sling/solid seat/back, patient weight 301 to 450 pounds', category: 'Power Wheelchairs' },
  { code: 'K0886', shortDescription: 'PWC Grp 5 pediatric single power', longDescription: 'Power wheelchair, group 5 pediatric, single power option, sling/solid seat/back', category: 'Power Wheelchairs' },
  { code: 'K0890', shortDescription: 'PWC Grp 5 pediatric multiple power', longDescription: 'Power wheelchair, group 5 pediatric, multiple power option, sling/solid seat/back', category: 'Power Wheelchairs' },

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

  // Ventilators & Ventilator Supplies
  { code: 'E0450', shortDescription: 'Volume ventilator, stationary', longDescription: 'Volume ventilator, stationary or portable, with any type of breathing circuit, non-invasive interface (e.g., mask)', category: 'Ventilators' },
  { code: 'E0457', shortDescription: 'Chest shell ventilator', longDescription: 'Chest shell (cuirass) ventilator', category: 'Ventilators' },
  { code: 'E0459', shortDescription: 'Ventilator, non-invasive interface', longDescription: 'Ventilator, non-invasive interface type, used with positive pressure ventilator', category: 'Ventilators' },
  { code: 'E0460', shortDescription: 'Negative pressure ventilator', longDescription: 'Negative pressure ventilator; portable or stationary', category: 'Ventilators' },
  { code: 'E0461', shortDescription: 'Volume ventilator non-invasive', longDescription: 'Volume ventilator, stationary or portable, used with non-invasive interface', category: 'Ventilators' },
  { code: 'E0463', shortDescription: 'Pressure ventilator non-invasive', longDescription: 'Pressure support ventilator with volume ventilation mode, used with non-invasive interface', category: 'Ventilators' },
  { code: 'E0464', shortDescription: 'Pressure ventilator invasive', longDescription: 'Pressure support ventilator with volume ventilation mode, used with invasive interface (e.g., tracheostomy tube)', category: 'Ventilators' },
  { code: 'E0465', shortDescription: 'Home ventilator, invasive', longDescription: 'Home ventilator, any type, used with invasive interface (e.g., tracheostomy tube), with or without backup rate', category: 'Ventilators' },
  { code: 'E0466', shortDescription: 'Home ventilator, non-invasive', longDescription: 'Home ventilator, any type, used with non-invasive interface (e.g., mask), with or without backup rate', category: 'Ventilators' },
  { code: 'E0467', shortDescription: 'Home ventilator, multi-function', longDescription: 'Home ventilator, multi-function respiratory device, also performs any or all of the additional functions of oxygen concentration, drug nebulization, aspiration', category: 'Ventilators' },
  { code: 'A4481', shortDescription: 'Tracheostomy filter', longDescription: 'Tracheostomy filter, any type, any size, each', category: 'Ventilator Supplies' },
  { code: 'A4483', shortDescription: 'Moisture exchanger for trach', longDescription: 'Moisture exchanger, disposable, for use with invasive mechanical ventilation', category: 'Ventilator Supplies' },
  { code: 'A7520', shortDescription: 'Tracheostomy/laryngectomy tube', longDescription: 'Tracheostomy/laryngectomy tube, non-cuffed, polyvinylchloride (PVC), silicone or equal, each', category: 'Ventilator Supplies' },
  { code: 'A7521', shortDescription: 'Tracheostomy/laryngectomy tube cuffed', longDescription: 'Tracheostomy/laryngectomy tube, cuffed, polyvinylchloride (PVC), silicone or equal, each', category: 'Ventilator Supplies' },
  { code: 'A7522', shortDescription: 'Tracheostomy inner cannula', longDescription: 'Tracheostomy/laryngectomy tube, stainless steel or equal (sterilizable and reusable), each', category: 'Ventilator Supplies' },
  { code: 'A7523', shortDescription: 'Tracheostomy shower protector', longDescription: 'Tracheostomy shower protector, each', category: 'Ventilator Supplies' },
  { code: 'A7524', shortDescription: 'Tracheostomy stent/button', longDescription: 'Tracheostomy/laryngectomy tube plug/stop, each', category: 'Ventilator Supplies' },
  { code: 'A7525', shortDescription: 'Tracheostomy mask/collar', longDescription: 'Tracheostomy mask, each', category: 'Ventilator Supplies' },
  { code: 'A7526', shortDescription: 'Tracheostomy tube collar/holder', longDescription: 'Tracheostomy tube collar/holder, each', category: 'Ventilator Supplies' },

  // CPAP/BiPAP Supplies & Accessories
  { code: 'A7027', shortDescription: 'CPAP/BiPAP combination oral/nasal mask', longDescription: 'Combination oral/nasal mask, used with continuous positive airway pressure device, each', category: 'CPAP Supplies' },
  { code: 'A7028', shortDescription: 'CPAP/BiPAP oral cushion', longDescription: 'Oral cushion for combination oral/nasal mask, replacement only, each', category: 'CPAP Supplies' },
  { code: 'A7029', shortDescription: 'CPAP/BiPAP nasal pillows', longDescription: 'Nasal pillows for combination oral/nasal mask, replacement only, pair', category: 'CPAP Supplies' },
  { code: 'A7030', shortDescription: 'CPAP full face mask', longDescription: 'Full face mask used with positive airway pressure device, each', category: 'CPAP Supplies' },
  { code: 'A7031', shortDescription: 'CPAP face mask interface', longDescription: 'Face mask interface, replacement for full face mask, each', category: 'CPAP Supplies' },
  { code: 'A7032', shortDescription: 'CPAP nasal cushion', longDescription: 'Cushion for nasal mask interface, replacement only, each', category: 'CPAP Supplies' },
  { code: 'A7033', shortDescription: 'CPAP nasal pillow interface', longDescription: 'Pillow for use on nasal cannula type interface, replacement only, pair', category: 'CPAP Supplies' },
  { code: 'A7034', shortDescription: 'CPAP nasal mask', longDescription: 'Nasal interface (mask or cannula type) used with positive airway pressure device, with or without head strap', category: 'CPAP Supplies' },
  { code: 'A7035', shortDescription: 'CPAP headgear', longDescription: 'Headgear used with positive airway pressure device', category: 'CPAP Supplies' },
  { code: 'A7036', shortDescription: 'CPAP chinstrap', longDescription: 'Chinstrap used with positive airway pressure device', category: 'CPAP Supplies' },
  { code: 'A7037', shortDescription: 'CPAP tubing', longDescription: 'Tubing used with positive airway pressure device', category: 'CPAP Supplies' },
  { code: 'A7038', shortDescription: 'CPAP disposable filter', longDescription: 'Filter, disposable, used with positive airway pressure device', category: 'CPAP Supplies' },
  { code: 'A7039', shortDescription: 'CPAP non-disposable filter', longDescription: 'Filter, non-disposable, used with positive airway pressure device', category: 'CPAP Supplies' },
  { code: 'A7044', shortDescription: 'CPAP oral interface', longDescription: 'Oral interface used with positive airway pressure device, each', category: 'CPAP Supplies' },
  { code: 'A7045', shortDescription: 'CPAP exhalation port', longDescription: 'Exhalation port with or without swivel used with positive airway pressure device, replacement only', category: 'CPAP Supplies' },
  { code: 'A7046', shortDescription: 'CPAP humidifier water chamber', longDescription: 'Water chamber for humidifier, used with positive airway pressure device, replacement, each', category: 'CPAP Supplies' },
  { code: 'E0561', shortDescription: 'Humidifier, non-heated, CPAP', longDescription: 'Humidifier, non-heated, used with positive airway pressure device', category: 'CPAP Supplies' },
  { code: 'E0562', shortDescription: 'Humidifier, heated, CPAP', longDescription: 'Humidifier, heated, used with positive airway pressure device', category: 'CPAP Supplies' },

  // Catheter Supplies
  { code: 'A4338', shortDescription: 'Indwelling catheter, Foley, 2-way', longDescription: 'Indwelling catheter; Foley type, two-way latex with coating (Teflon, silicone, silicone elastomer, or hydrophilic, etc.), each', category: 'Catheter Supplies' },
  { code: 'A4340', shortDescription: 'Indwelling catheter, specialty', longDescription: 'Indwelling catheter; specialty type, (e.g., Coude, mushroom, wing, etc.), each', category: 'Catheter Supplies' },
  { code: 'A4344', shortDescription: 'Indwelling catheter, Foley, 2-way silicone', longDescription: 'Indwelling catheter, Foley type, two-way, all silicone, each', category: 'Catheter Supplies' },
  { code: 'A4346', shortDescription: 'Indwelling catheter, Foley, 3-way', longDescription: 'Indwelling catheter; Foley type, three-way for continuous irrigation, each', category: 'Catheter Supplies' },
  { code: 'A4351', shortDescription: 'Intermittent catheter, straight tip', longDescription: 'Intermittent urinary catheter; straight tip, with or without coating (Teflon, silicone, silicone elastomer, or hydrophilic, etc.), each', category: 'Catheter Supplies' },
  { code: 'A4352', shortDescription: 'Intermittent catheter, coude tip', longDescription: 'Intermittent urinary catheter; Coude (curved) tip, with or without coating (Teflon, silicone, silicone elastomer, or hydrophilic, etc.), each', category: 'Catheter Supplies' },
  { code: 'A4353', shortDescription: 'Intermittent catheter, w/insertion supply', longDescription: 'Intermittent urinary catheter, with insertion supplies', category: 'Catheter Supplies' },
  { code: 'A4354', shortDescription: 'Catheter insertion tray w/drainage', longDescription: 'Insertion tray with drainage bag with indwelling catheter, Foley type, two-way latex with coating (Teflon, silicone, silicone elastomer or hydrophilic, etc.)', category: 'Catheter Supplies' },
  { code: 'A4355', shortDescription: 'Bladder irrigation tubing', longDescription: 'Irrigation tubing set for continuous bladder irrigation through a three-way indwelling Foley catheter, each', category: 'Catheter Supplies' },
  { code: 'A4356', shortDescription: 'External urethral clamp', longDescription: 'External urethral clamp or compression device (not to be used for catheter clamp), each', category: 'Catheter Supplies' },
  { code: 'A4357', shortDescription: 'Bedside drainage bag', longDescription: 'Bedside drainage bag, day or night, with or without anti-reflux device, with or without tube, each', category: 'Catheter Supplies' },
  { code: 'A4358', shortDescription: 'Urinary leg bag', longDescription: 'Urinary drainage bag, leg or abdomen, vinyl, with or without tube, with straps, each', category: 'Catheter Supplies' },
  { code: 'A4360', shortDescription: 'Catheter leg strap/holder', longDescription: 'Disposable external urethral clamp or compression device', category: 'Catheter Supplies' },
  { code: 'A4400', shortDescription: 'Ostomy/catheter irrigation syringe', longDescription: 'Ostomy irrigation set', category: 'Catheter Supplies' },
  { code: 'A4402', shortDescription: 'Lubricant, individual packet', longDescription: 'Lubricant, per ounce', category: 'Catheter Supplies' },
  { code: 'A5105', shortDescription: 'Catheter anchoring device', longDescription: 'Urinary suspension system or body worn catheter anchoring device, each', category: 'Catheter Supplies' },
  { code: 'A5112', shortDescription: 'Urinary leg bag latex', longDescription: 'Urinary leg bag; latex', category: 'Catheter Supplies' },
  { code: 'A5113', shortDescription: 'Urinary leg bag vinyl', longDescription: 'Leg strap; latex, replacement only, per set', category: 'Catheter Supplies' },
  { code: 'A5114', shortDescription: 'Leg strap, foam or fabric', longDescription: 'Leg strap; foam or fabric, replacement only, per set', category: 'Catheter Supplies' },

  // Incontinence Supplies
  { code: 'A4310', shortDescription: 'Insertion tray w/o drainage', longDescription: 'Insertion tray without drainage bag and without catheter (accessories only)', category: 'Incontinence Supplies' },
  { code: 'A4311', shortDescription: 'Insertion tray w/o drainage w/ Foley', longDescription: 'Insertion tray without drainage bag with indwelling catheter, Foley type, two-way latex with coating', category: 'Incontinence Supplies' },
  { code: 'A4312', shortDescription: 'Insertion tray w/o drainage, silicone', longDescription: 'Insertion tray without drainage bag with indwelling catheter, Foley type, two-way, all silicone', category: 'Incontinence Supplies' },
  { code: 'A4313', shortDescription: 'Insertion tray w/ drainage', longDescription: 'Insertion tray without drainage bag with indwelling catheter, Foley type, three-way, for continuous irrigation', category: 'Incontinence Supplies' },
  { code: 'A4314', shortDescription: 'Insertion tray w/ Foley catheter', longDescription: 'Insertion tray with drainage bag with indwelling catheter, Foley type, two-way, all silicone', category: 'Incontinence Supplies' },
  { code: 'A4320', shortDescription: 'Irrigation tray, catheter', longDescription: 'Irrigation tray with bulb or piston syringe, any purpose', category: 'Incontinence Supplies' },
  { code: 'A4326', shortDescription: 'Male external catheter, specialty', longDescription: 'Male external catheter, with integral collection chamber, adhesive, each', category: 'Incontinence Supplies' },
  { code: 'A4327', shortDescription: 'Female external urinary device', longDescription: 'Female external urinary collection device; meatal cup, each', category: 'Incontinence Supplies' },
  { code: 'A4328', shortDescription: 'Female external urinary pouch', longDescription: 'Female external urinary collection device; pouch, each', category: 'Incontinence Supplies' },
  { code: 'A4330', shortDescription: 'Perianal fecal collection pouch', longDescription: 'Perianal fecal collection pouch with adhesive, each', category: 'Incontinence Supplies' },
  { code: 'A4331', shortDescription: 'Extension drainage tubing', longDescription: 'Extension drainage tubing, any type, any length, with connector/adaptor, for use with urinary leg bag or urostomy pouch, each', category: 'Incontinence Supplies' },
  { code: 'A4332', shortDescription: 'Lubricant, individual sterile', longDescription: 'Lubricant, individual sterile packet, each', category: 'Incontinence Supplies' },
  { code: 'A4335', shortDescription: 'Incontinence supply, misc', longDescription: 'Incontinence supply; miscellaneous', category: 'Incontinence Supplies' },
  { code: 'T4521', shortDescription: 'Adult diaper/brief, small', longDescription: 'Adult sized disposable incontinence product, brief/diaper type, small, each', category: 'Incontinence Supplies' },
  { code: 'T4522', shortDescription: 'Adult diaper/brief, medium', longDescription: 'Adult sized disposable incontinence product, brief/diaper type, medium, each', category: 'Incontinence Supplies' },
  { code: 'T4523', shortDescription: 'Adult diaper/brief, large', longDescription: 'Adult sized disposable incontinence product, brief/diaper type, large, each', category: 'Incontinence Supplies' },
  { code: 'T4524', shortDescription: 'Adult diaper/brief, extra large', longDescription: 'Adult sized disposable incontinence product, brief/diaper type, extra large, each', category: 'Incontinence Supplies' },
  { code: 'T4525', shortDescription: 'Adult pull-on, small', longDescription: 'Adult sized disposable incontinence product, protective underwear/pull-on, small size, each', category: 'Incontinence Supplies' },
  { code: 'T4526', shortDescription: 'Adult pull-on, medium', longDescription: 'Adult sized disposable incontinence product, protective underwear/pull-on, medium size, each', category: 'Incontinence Supplies' },
  { code: 'T4527', shortDescription: 'Adult pull-on, large', longDescription: 'Adult sized disposable incontinence product, protective underwear/pull-on, large size, each', category: 'Incontinence Supplies' },
  { code: 'T4528', shortDescription: 'Adult pull-on, extra large', longDescription: 'Adult sized disposable incontinence product, protective underwear/pull-on, extra large size, each', category: 'Incontinence Supplies' },
  { code: 'T4529', shortDescription: 'Pads/liners, small', longDescription: 'Pediatric sized disposable incontinence product, brief/diaper type, small/medium size, each', category: 'Incontinence Supplies' },
  { code: 'T4530', shortDescription: 'Pads/liners, large', longDescription: 'Pediatric sized disposable incontinence product, brief/diaper type, large size, each', category: 'Incontinence Supplies' },
  { code: 'T4533', shortDescription: 'Youth pull-on, small/medium', longDescription: 'Youth sized disposable incontinence product, brief/diaper type, small/medium size, each', category: 'Incontinence Supplies' },
  { code: 'T4534', shortDescription: 'Youth pull-on, large', longDescription: 'Youth sized disposable incontinence product, brief/diaper type, large size, each', category: 'Incontinence Supplies' },
  { code: 'T4535', shortDescription: 'Disposable underpad, small', longDescription: 'Disposable incontinence product, booster pad/liner, small, each', category: 'Incontinence Supplies' },
  { code: 'T4536', shortDescription: 'Disposable underpad, large', longDescription: 'Disposable incontinence product, booster pad/liner, large, each', category: 'Incontinence Supplies' },
  { code: 'T4541', shortDescription: 'Underpad, reusable, bed size', longDescription: 'Incontinence product, reusable underpad, bed size, each', category: 'Incontinence Supplies' },
  { code: 'T4543', shortDescription: 'Underpad, disposable, bed size', longDescription: 'Adult sized disposable incontinence product, protective brief/diaper, above extra large, each', category: 'Incontinence Supplies' },

  // Hospital Bed Accessories
  { code: 'E0280', shortDescription: 'Bed cradle, any type', longDescription: 'Bed cradle, any type, includes all sizes', category: 'Hospital Bed Accessories' },
  { code: 'E0290', shortDescription: 'Hospital bed fixed height, w/o mattress', longDescription: 'Hospital bed, fixed height, without side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0291', shortDescription: 'Hospital bed fixed height, w/o mattress w/ rails', longDescription: 'Hospital bed, fixed height, with side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0292', shortDescription: 'Hospital bed variable, w/o mattress', longDescription: 'Hospital bed, variable height, hi-lo, without side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0293', shortDescription: 'Hospital bed variable, w/o mattress w/ rails', longDescription: 'Hospital bed, variable height, hi-lo, with side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0294', shortDescription: 'Hospital bed semi-electric, w/o mattress', longDescription: 'Hospital bed, semi-electric (head and foot adjustment), without side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0295', shortDescription: 'Hospital bed semi-electric, w/o mattress w/ rails', longDescription: 'Hospital bed, semi-electric (head and foot adjustment), with side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0296', shortDescription: 'Hospital bed total electric, w/o mattress', longDescription: 'Hospital bed, total electric (head, foot and height adjustments), without side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0297', shortDescription: 'Hospital bed total electric, w/o mattress w/ rails', longDescription: 'Hospital bed, total electric (head, foot and height adjustments), with side rails, without mattress', category: 'Hospital Bed Accessories' },
  { code: 'E0300', shortDescription: 'Pediatric crib, hospital grade', longDescription: 'Pediatric crib, hospital grade, fully enclosed', category: 'Hospital Bed Accessories' },
  { code: 'E0305', shortDescription: 'Bed side rails, half length', longDescription: 'Bed side rails, half length, fixed, includes all components and accessories', category: 'Hospital Bed Accessories' },
  { code: 'E0310', shortDescription: 'Bed side rails, full length', longDescription: 'Bed side rails, full length, fixed, includes all components and accessories', category: 'Hospital Bed Accessories' },
  { code: 'E0315', shortDescription: 'Bed accessory, board/table/support', longDescription: 'Bed accessory: board, table, or support device, any type', category: 'Hospital Bed Accessories' },
  { code: 'E0316', shortDescription: 'Safety enclosure frame/canopy', longDescription: 'Safety enclosure frame/canopy for use with hospital bed, any type', category: 'Hospital Bed Accessories' },

  // Wheelchair Accessories
  { code: 'E0950', shortDescription: 'WC tray', longDescription: 'Wheelchair accessory, tray, each', category: 'Wheelchair Accessories' },
  { code: 'E0951', shortDescription: 'WC heel loop/strap', longDescription: 'Wheelchair accessory, heel loop/holder, any type, each', category: 'Wheelchair Accessories' },
  { code: 'E0952', shortDescription: 'WC toe loop/strap', longDescription: 'Wheelchair accessory, toe loop/holder, any type, each', category: 'Wheelchair Accessories' },
  { code: 'E0955', shortDescription: 'WC headrest', longDescription: 'Wheelchair accessory, headrest, cushioned, any type, including fixed mounting hardware, each', category: 'Wheelchair Accessories' },
  { code: 'E0956', shortDescription: 'WC lateral trunk support', longDescription: 'Wheelchair accessory, lateral trunk or hip support, any type, including fixed mounting hardware, each', category: 'Wheelchair Accessories' },
  { code: 'E0957', shortDescription: 'WC medial thigh support', longDescription: 'Wheelchair accessory, medial thigh support, any type, including fixed mounting hardware, each', category: 'Wheelchair Accessories' },
  { code: 'E0960', shortDescription: 'WC shoulder harness/strap', longDescription: 'Wheelchair accessory, shoulder harness/straps or chest strap, including any type mounting hardware', category: 'Wheelchair Accessories' },
  { code: 'E0961', shortDescription: 'WC shoulder elbow mobile arm support', longDescription: 'Wheelchair accessory, shoulder elbow, mobile arm support attached to wheelchair, balanced, adjustable', category: 'Wheelchair Accessories' },
  { code: 'E0966', shortDescription: 'WC lateral knee/thigh pad', longDescription: 'Wheelchair accessory, headrest extension, each', category: 'Wheelchair Accessories' },
  { code: 'E0967', shortDescription: 'WC hand rim', longDescription: 'Wheelchair accessory, hand rim with projections, any type, each', category: 'Wheelchair Accessories' },
  { code: 'E0970', shortDescription: 'WC elevating leg rests', longDescription: 'Wheelchair accessory, no. 2 footplates, each', category: 'Wheelchair Accessories' },
  { code: 'E0971', shortDescription: 'WC anti-tippers', longDescription: 'Wheelchair accessory, anti-tipping device, each', category: 'Wheelchair Accessories' },
  { code: 'E0973', shortDescription: 'WC adjustable height detach armrest', longDescription: 'Wheelchair accessory, adjustable height, detachable armrest, complete assembly, each', category: 'Wheelchair Accessories' },
  { code: 'E1002', shortDescription: 'WC power seating system, tilt only', longDescription: 'Wheelchair accessory, power seating system, tilt only', category: 'Wheelchair Accessories' },
  { code: 'E1003', shortDescription: 'WC power seating, recline only', longDescription: 'Wheelchair accessory, power seating system, recline only, without shear reduction', category: 'Wheelchair Accessories' },
  { code: 'E1004', shortDescription: 'WC power seating, recline w/ shear', longDescription: 'Wheelchair accessory, power seating system, recline only, with mechanical shear reduction', category: 'Wheelchair Accessories' },
  { code: 'E1005', shortDescription: 'WC power seating, recline w/ power shear', longDescription: 'Wheelchair accessory, power seating system, recline only, with power shear reduction', category: 'Wheelchair Accessories' },
  { code: 'E1006', shortDescription: 'WC power seating, tilt and recline', longDescription: 'Wheelchair accessory, power seating system, combination tilt and recline, without shear reduction', category: 'Wheelchair Accessories' },
  { code: 'E1007', shortDescription: 'WC power seating, tilt and recline w/ shear', longDescription: 'Wheelchair accessory, power seating system, combination tilt and recline, with mechanical shear reduction', category: 'Wheelchair Accessories' },
  { code: 'E1008', shortDescription: 'WC power seating, tilt and recline w/ power shear', longDescription: 'Wheelchair accessory, power seating system, combination tilt and recline, with power shear reduction', category: 'Wheelchair Accessories' },
  { code: 'E1009', shortDescription: 'WC power seating, power legs', longDescription: 'Wheelchair accessory, addition to power seating system, mechanically linked leg elevation system, including pushrod and leg rest', category: 'Wheelchair Accessories' },
  { code: 'E1010', shortDescription: 'WC power seating, power legs articulating', longDescription: 'Wheelchair accessory, addition to power seating system, power leg elevation system, including leg rest, pair', category: 'Wheelchair Accessories' },
  { code: 'E1011', shortDescription: 'WC seat modification', longDescription: 'Wheelchair modification, seat upholstery replacement, each', category: 'Wheelchair Accessories' },
  { code: 'E1012', shortDescription: 'WC back modification', longDescription: 'Wheelchair modification, back upholstery replacement, each', category: 'Wheelchair Accessories' },
  { code: 'E1014', shortDescription: 'WC reclining back addition', longDescription: 'Wheelchair reclining back addition, each', category: 'Wheelchair Accessories' },
  { code: 'E1020', shortDescription: 'WC residual limb support', longDescription: 'Wheelchair residual limb support system, any type, each', category: 'Wheelchair Accessories' },
  { code: 'E1028', shortDescription: 'WC manual standing system', longDescription: 'Wheelchair accessory, manual swingaway, retractable or removable mounting hardware for joystick, other technology interface or positioning accessory', category: 'Wheelchair Accessories' },
  { code: 'E1029', shortDescription: 'WC ventilator tray', longDescription: 'Wheelchair accessory, ventilator tray, fixed', category: 'Wheelchair Accessories' },
  { code: 'E1030', shortDescription: 'WC ventilator tray, gimbaled', longDescription: 'Wheelchair accessory, ventilator tray, gimbaled', category: 'Wheelchair Accessories' },
  { code: 'K0108', shortDescription: 'WC accessory NOS', longDescription: 'Wheelchair component or accessory, not otherwise specified', category: 'Wheelchair Accessories' },

  // Respiratory Supplies (nebulizer, O2 accessories)
  { code: 'A7003', shortDescription: 'Nebulizer administration set', longDescription: 'Administration set, with small volume nonfiltered pneumatic nebulizer, disposable', category: 'Respiratory Supplies' },
  { code: 'A7004', shortDescription: 'Nebulizer admin set, filtered', longDescription: 'Small volume nonfiltered pneumatic nebulizer, disposable', category: 'Respiratory Supplies' },
  { code: 'A7005', shortDescription: 'Nebulizer admin set, reusable', longDescription: 'Administration set, with small volume nonfiltered pneumatic nebulizer, non-disposable', category: 'Respiratory Supplies' },
  { code: 'A7006', shortDescription: 'Nebulizer admin set, filtered reusable', longDescription: 'Administration set, with small volume filtered pneumatic nebulizer', category: 'Respiratory Supplies' },
  { code: 'A7010', shortDescription: 'Nebulizer corrugated tubing', longDescription: 'Corrugated tubing, disposable, used with large volume nebulizer, 100 feet', category: 'Respiratory Supplies' },
  { code: 'A7012', shortDescription: 'Nebulizer water collection device', longDescription: 'Water collection device, used with large volume nebulizer', category: 'Respiratory Supplies' },
  { code: 'A7013', shortDescription: 'Nebulizer filter, disposable', longDescription: 'Filter, disposable, used with aerosol compressor or ultrasonic generator', category: 'Respiratory Supplies' },
  { code: 'A7014', shortDescription: 'Nebulizer filter, non-disposable', longDescription: 'Filter, non-disposable, used with aerosol compressor or ultrasonic generator', category: 'Respiratory Supplies' },
  { code: 'A7015', shortDescription: 'Aerosol mask', longDescription: 'Aerosol mask, used with DME nebulizer', category: 'Respiratory Supplies' },
  { code: 'A7016', shortDescription: 'Nebulizer dome and mouthpiece', longDescription: 'Dome and mouthpiece, used with small volume ultrasonic nebulizer', category: 'Respiratory Supplies' },
  { code: 'A7017', shortDescription: 'Nebulizer large volume', longDescription: 'Large volume nebulizer, disposable, unfilled, used with aerosol compressor', category: 'Respiratory Supplies' },
  { code: 'A7018', shortDescription: 'Nebulizer large volume, non-disposable', longDescription: 'Large volume nebulizer, non-disposable, used with aerosol compressor', category: 'Respiratory Supplies' },
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
