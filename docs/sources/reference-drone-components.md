# Reference 5-inch drone: sourced assembly

Source access date: **2026-08-27**.

The reference is an onboard-complete 5-inch, 6S, analog FPV quad. The topology
solver designs the frame around the same immutable component revisions, masses,
mounts, collision volumes, cable corridors, and retention access that the
viewport displays. Goggles, transmitter radio, charger, and ground equipment
are intentionally outside the airborne assembly.

## Flight hardware

| Qty | Catalog record | Actual product and mechanical facts | Accounted mass | Representation and source |
| ---: | --- | --- | ---: | --- |
| 4 | `motor-2207` | Hobbywing XRotor 2207.5SL 1780KV; Ø28 × 19.9 mm, 4×M3 on Ø16 mm, 150 mm 20AWG leads | 38 g each | Specification reconstruction from the [official datasheet](https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf), [product page](https://www.hobbywing.com/en/products/xrotor-22075), and official dimension drawing. |
| 4 | `propeller-5x4.3x3` | HQProp HQ5X4.3X3V2S-PC; 5 in, 4.3 in pitch, 3 blades, Ø12.8 × 6.5 mm hub, Ø5 mm shaft | 3.8 g each | Bounded blade reconstruction inside the exact overall envelope; [official product page](https://www.hqprop.com/hq-freestyle-prop-5x43x3v2s-2cw2ccw-poly-carbonate-p0233.html). |
| 1 | `flight-controller-30x30` | OpenDrone OpenFC-Lite rev3.3; exact 37.942302 × 37.942302 × 5.38 mm release geometry, 30.5 mm mount square | 17 g engineering budget | Redistributable release STEP converted to the included GLB; [release](https://github.com/OpenDrone-hw/OpenFC-Lite/releases/tag/rev3.3) and [product specification](https://opendrone.be/products/openfc-lite). The unpublished mass remains explicitly provisional. |
| 1 | `esc-30x30` | OpenDrone OpenESC-30x30 rev3.3; exact 41.62706 × 42.504999 × 6.33 mm release geometry, 30.5 mm mount square | 17 g engineering budget | Redistributable release STEP converted to the included GLB; [release](https://github.com/OpenDrone-hw/OpenESC-30x30/releases/tag/rev3.3). The unpublished mass remains explicitly provisional. |
| 1 | `battery-6s-1550` | Tattu R-Line V5 1550 mAh 6S 150C; 78 × 37 × 52 mm, XT60, 45 mm 12AWG leads | 254 g | Specification reconstruction; [official product page](https://www.genstattu.com/tattu-r-line-version-5-0-1550mah-6s-150c-22-2v-lipo-battery-pack-with-xt60-plug/). Published tolerances are ±5/2/2 mm and ±20 g. |
| 1 | `fpv-camera` | RunCam Phoenix 2; 19 × 19 × 20 mm housing, 9 g, M2 side mounts, M12 lens | 9 g | Specification reconstruction with bounded lens detail; [official manual](https://www.runcam.com/download/Phoenix2/Phoenix_2_Manual.pdf). |
| 1 | `video-transmitter` | SpeedyBee TX800; 28 × 28 × 6 mm, 20 × 20 mm M3 heatsink holes, MMCX, supplied 1.0 mm 4-pin cable | 5.6 g without antenna | Detailed bounded reconstruction; [official product page](https://www.speedybee.com/speedybee-tx800/). |
| 1 | `video-antenna` | Foxeer PA1474 Lollipop 4 Plus RHCP, straight MMCX; Ø11 × 60 mm | 4.4 g | Overall envelope, connector, and mass are exact; radiator detail is bounded; [official product page](https://www.foxeer.com/foxeer-lollipop-4-plus-high-quality-5-8g-2-6dbi-fpv-omni-lds-antenna-2pcs-g-374). |
| 1 | `radio-receiver` | RadioMaster RP1 V2 ExpressLRS 2.4 GHz; 13 × 11 × 3 mm board, supplied 65 mm T antenna and CRSF wire | 2.2 g including antenna | Board, coax, and T element have separate collision/clearance volumes; [official product page](https://radiomasterrc.com/products/rp1-expresslrs-2-4ghz-nano-receiver). |

## Real retention and attachment hardware

| Qty | Catalog record | Product | Published facts used | Source |
| ---: | --- | --- | --- | --- |
| 16 + 4 | `fastener-m3x8` | Accu SSCF-M3-8-12.9-Z | M3×8, Ø5.68 × 3 mm head, 0.8 g | [Supplier specification](https://www.accu.co.uk/metric-cap-head-screws/386767-SSCF-M3-8-12-9-Z) |
| 2 | `camera-fastener-m2x4` | Accu SSCF-M2-4-A4-BL | M2×4, Ø3.8 × 2 mm head, 0.18 g | [Supplier specification](https://www.accu.co.uk/metric-cap-head-screws/152298-SSCF-M2-4-A4-BL) |
| 4 | `stack-bolt-m3x25` | Accu SSC-M3-25-12.9-Z | M3×25, Ø5.68 × 3 mm head, 2 g | [Supplier specification](https://www.accu.co.uk/metric-cap-head-screws/386772-SSC-M3-25-12-9-Z) |
| 4 | `stack-spacer-m3x6` | Harwin R30-6700694 | Ø5 × 6 mm, Ø3.2 mm bore, 0.113 g | [Supplier specification](https://www.harwin.com/products/R30-6700694) |
| 4 + 4 | `stack-spacer-m3x5` | Harwin R30-6700594 | Ø5 × 5 mm, Ø3.2 mm bore, 0.094 g | [Supplier specification](https://www.harwin.com/products/R30-6700594) |
| 4 | `stack-locknut-m3` | NBK SWUT-M3 | M3×0.5, 5.5 mm AF, 4 mm high, 0.27 g | [Supplier specification](https://www.nbk1560.com/en/products/specialscrew/nedzicom/stoploosening/SWUT/SWUT-M3/) |
| 2 | `battery-retention-strap` | Rotorama silicone battery strap 20×250 | 20 × 250 mm, 4.7 g | [Supplier specification](https://www.rotorama.com/product/rotorama-battery-strap-silikonovy-20x250) |

The four 25 mm bolts, lower 6 mm spacers, inter-board 5 mm spacers, and locknuts
form the OpenESC/OpenFC stack. Four additional M3×8 screws and 5 mm spacers
mount the TX800 on its published 20 mm square. Two black M2×4 screws run along
the camera's real side-mount axes. These are separate mass-bearing component
instances, not decorative cylinders or a combined invented column.

## Generated interfaces and routing

- The generated body supplies the motor plates, battery deck with four
  full-depth strap slots, camera U-bracket, TX800 bearing deck and four holes,
  RP1 cradle, and Foxeer antenna U-clip. These are frame features, not purchased
  parts pretending to be catalog hardware.
- The XT60-to-OpenESC 12AWG lead and four trimmed 3×20AWG motor routes terminate
  exactly on their component interfaces. Their collision and clearance
  geometry is included in topology input, while the derived motor corridors use
  `massAccounting: none` to avoid double-counting the motor's published lead
  mass.
- The TX800 package includes its 4-pin cable and the RP1 package includes its
  CRSF wire. Their electrical connector interfaces are recorded, but no
  manufacturer publishes installed wire paths or pad coordinates for this
  OpenFC combination. The system therefore does not claim invented sub-mm cable
  placement as official geometry; production routing remains an explicit
  assembly task and must be verified on the physical build.

## Engineering boundary

The included OpenFC/OpenESC geometry is sourced release CAD. Other proprietary
products are high-detail, facts-only reconstructions inside their published
envelopes; no third-party CAD or imagery is redistributed. The 538.444 g model
mass includes every standalone onboard item above and drives center-of-mass and
inertial-load calculations. It is suitable for layout, collision planning,
topology constraints, and provisional structural simulation—not certified CFD,
thermal, vibration, fatigue, RF, or manufacturing validation. Board mass
budgets, unpublished tolerances, solder joints, and final cable bends must be
measured before manufacturing or flight.
