import type {
  DecisionAnswerPayload,
  DecisionChoiceAnswer,
  DecisionNoulAnswer,
} from '../schemas/decisions';

export interface HistoricalEraDefinition {
  id: string;
  eraName: string;
  description: string;
  defaultStartYear: number;
  defaultEndYear: number;
}

export interface ChronologicalBucketDefinition {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
}

export const HISTORICAL_ERAS: readonly HistoricalEraDefinition[] = [
  {
    id: 'prehistory_neolithic',
    eraName: 'Prehistory & Neolithic Era',
    description:
      'Early human prehistory, Ice Age, and Neolithic settlements before 3000 BCE',
    defaultStartYear: -8000,
    defaultEndYear: -7900,
  },
  {
    id: 'ancient_mesopotamia_egypt',
    eraName: 'Bronze Age & Ancient Near East',
    description:
      'Sumer, Babylon, Old/Middle/New Kingdom Egypt, Bronze Age civilizations (3000–1200 BCE)',
    defaultStartYear: -2000,
    defaultEndYear: -1900,
  },
  {
    id: 'homeric_iron_age',
    eraName: 'Iron Age & Homeric Antiquity',
    description:
      'Trojan War mythos, Iron Age Levant, Vedic India, Zhou China (1200–600 BCE)',
    defaultStartYear: -800,
    defaultEndYear: -750,
  },
  {
    id: 'classical_greece',
    eraName: 'Classical Greece',
    description:
      'Athenian democracy, Persian & Peloponnesian Wars, Socrates/Plato/Aristotle (510–323 BCE)',
    defaultStartYear: -450,
    defaultEndYear: -390,
  },
  {
    id: 'hellenistic_maurya_qin',
    eraName: 'Hellenistic & Warring States Era',
    description:
      'Alexander the Great, Ptolemaic Egypt, Maurya India, Warring States & Qin China (323–146 BCE)',
    defaultStartYear: -300,
    defaultEndYear: -220,
  },
  {
    id: 'late_roman_republic',
    eraName: 'Late Roman Republic',
    description:
      'Cicero, Julius Caesar, Spartacus, fall of the Roman Republic (146–27 BCE)',
    defaultStartYear: -80,
    defaultEndYear: -27,
  },
  {
    id: 'roman_empire_han',
    eraName: 'Roman Empire & Han Dynasty',
    description:
      'Pax Romana, Imperial Rome, Second Temple Judea, Han Dynasty China (27 BCE–284 CE)',
    defaultStartYear: 1,
    defaultEndYear: 100,
  },
  {
    id: 'late_antiquity',
    eraName: 'Late Antiquity',
    description:
      'Decline of Western Rome, Early Byzantium, Gupta India, Sassanid Persia (284–600 CE)',
    defaultStartYear: 350,
    defaultEndYear: 450,
  },
  {
    id: 'early_middle_ages_tang',
    eraName: 'Early Middle Ages & Tang Era',
    description:
      'Rise of Islam, Carolingian Europe, Tang Dynasty China, Heian Japan beginnings (600–800 CE)',
    defaultStartYear: 700,
    defaultEndYear: 790,
  },
  {
    id: 'viking_islamic_golden_age',
    eraName: 'Viking Age & Islamic Golden Age',
    description:
      'Norse expeditions, Abbasid Baghdad, Anglo-Saxon England, Heian court Japan (800–1066 CE)',
    defaultStartYear: 900,
    defaultEndYear: 1000,
  },
  {
    id: 'high_middle_ages',
    eraName: 'High Middle Ages',
    description:
      'Norman Conquest, Crusades, Song Dynasty China, scholasticism & chivalric romance (1066–1300)',
    defaultStartYear: 1150,
    defaultEndYear: 1250,
  },
  {
    id: 'late_middle_ages',
    eraName: 'Late Middle Ages',
    description:
      'Hundred Years War, Black Death, Dante & Chaucer, Yuan/early Ming China, Mali Empire (1300–1450)',
    defaultStartYear: 1340,
    defaultEndYear: 1420,
  },
  {
    id: 'renaissance',
    eraName: 'Italian & Northern Renaissance',
    description:
      'Medici Florence, Gutenberg, Leonardo, pre-Columbian & early Age of Sail (1450–1550)',
    defaultStartYear: 1480,
    defaultEndYear: 1540,
  },
  {
    id: 'reformation_mughal_ming',
    eraName: 'Reformation & Early Empires',
    description:
      'Protestant Reformation, Ottoman & Mughal Empires, late Ming China, Spanish Americas (1517–1600)',
    defaultStartYear: 1530,
    defaultEndYear: 1590,
  },
  {
    id: 'elizabethan_jacobean',
    eraName: 'Elizabethan & Jacobean Era',
    description:
      'Tudor/Stuart England, Shakespeare, Cervantes, early Edo/Tokugawa Japan (1558–1625)',
    defaultStartYear: 1580,
    defaultEndYear: 1620,
  },
  {
    id: 'seventeenth_century_baroque',
    eraName: 'Seventeenth Century & Baroque Era',
    description:
      'Thirty Years War, English Civil War, Dutch Golden Age, Louis XIV, Qing transition (1620–1700)',
    defaultStartYear: 1640,
    defaultEndYear: 1690,
  },
  {
    id: 'age_of_enlightenment',
    eraName: 'Age of Enlightenment',
    description:
      '18th-century salons, scientific & philosophical Enlightenment, High Qing & Edo eras (1700–1775)',
    defaultStartYear: 1730,
    defaultEndYear: 1775,
  },
  {
    id: 'age_of_revolutions',
    eraName: 'Age of Revolutions',
    description:
      'American, French, and Haitian Revolutions; birth of constitutional republics (1775–1800)',
    defaultStartYear: 1775,
    defaultEndYear: 1799,
  },
  {
    id: 'regency_napoleonic',
    eraName: 'Regency & Napoleonic Era',
    description:
      'Napoleonic Wars, Jane Austen Regency Britain, Latin American independence (1800–1830)',
    defaultStartYear: 1803,
    defaultEndYear: 1825,
  },
  {
    id: 'antebellum_romantic_era',
    eraName: 'Romantic & Antebellum Era',
    description:
      'Industrial Revolution, Romanticism, 1848 Revolutions, Antebellum US, Abolitionism (1830–1860)',
    defaultStartYear: 1835,
    defaultEndYear: 1860,
  },
  {
    id: 'american_civil_war_reconstruction',
    eraName: 'Civil War & Reconstruction',
    description:
      'American Civil War, emancipation, Reconstruction, Italian/German unification (1861–1877)',
    defaultStartYear: 1861,
    defaultEndYear: 1877,
  },
  {
    id: 'victorian_gilded_meiji',
    eraName: 'Victorian & Gilded Age',
    description:
      'High/Late Victorian Empire, US Gilded Age & American West, Tsarist Russia, Meiji Japan (1837–1901)',
    defaultStartYear: 1870,
    defaultEndYear: 1900,
  },
  {
    id: 'edwardian_belle_epoque',
    eraName: 'Belle Epoque & Edwardian Era',
    description:
      'Turn-of-the-century Paris/London/Vienna, early modernism, Mexican & 1905 revolutions (1900–1913)',
    defaultStartYear: 1900,
    defaultEndYear: 1913,
  },
  {
    id: 'world_war_i',
    eraName: 'World War I & Russian Revolution',
    description:
      'The Great War, Western/Eastern fronts, 1917 Russian Revolution, 1918 pandemic (1914–1919)',
    defaultStartYear: 1914,
    defaultEndYear: 1919,
  },
  {
    id: 'jazz_age_roaring_twenties',
    eraName: 'Jazz Age & Roaring Twenties',
    description:
      '1920s Harlem Renaissance, Lost Generation Paris, Weimar Republic, Prohibition (1920–1929)',
    defaultStartYear: 1920,
    defaultEndYear: 1929,
  },
  {
    id: 'great_depression_interwar',
    eraName: 'Great Depression & Interwar 1930s',
    description:
      'Dust Bowl, New Deal, Spanish Civil War, rise of totalitarianism in Europe & Asia (1929–1939)',
    defaultStartYear: 1930,
    defaultEndYear: 1939,
  },
  {
    id: 'world_war_ii',
    eraName: 'World War II',
    description:
      'Second World War across Europe, Pacific, North Africa, Holocaust, Home Front (1939–1945)',
    defaultStartYear: 1939,
    defaultEndYear: 1945,
  },
  {
    id: 'postwar_decolonization',
    eraName: 'Postwar & Decolonization Era',
    description:
      'Post-1945 reconstruction, Partition of India, early Cold War, 1950s society (1945–1959)',
    defaultStartYear: 1946,
    defaultEndYear: 1959,
  },
  {
    id: 'civil_rights_sixties',
    eraName: 'Sixties & Civil Rights Era',
    description:
      'Civil Rights Movement, Space Race, decolonization in Africa, Vietnam War, counterculture (1960–1969)',
    defaultStartYear: 1960,
    defaultEndYear: 1969,
  },
  {
    id: 'late_cold_war_seventies_eighties',
    eraName: 'Late Cold War (1970s–1980s)',
    description:
      'Watergate, post-industrial 1970s, Latin American dictatorships, 1980s Cold War & fall of Berlin Wall (1970–1991)',
    defaultStartYear: 1970,
    defaultEndYear: 1991,
  },
  {
    id: 'turn_of_millennium_nineties',
    eraName: 'Late 20th Century (1990s)',
    description:
      'Post-Soviet 1990s, early internet era, end of Apartheid, globalization (1990–1999)',
    defaultStartYear: 1990,
    defaultEndYear: 1999,
  },
  {
    id: 'early_twenty_first_century',
    eraName: 'Early 21st Century (2000s–2010s)',
    description:
      'Post-9/11 world, 2008 financial crisis, smartphone & social media age (2000–2019)',
    defaultStartYear: 2000,
    defaultEndYear: 2019,
  },
  {
    id: 'contemporary_era',
    eraName: 'Contemporary Era',
    description:
      'Present-day 2020s contemporary realism, current affairs, and modern life (2020–2029)',
    defaultStartYear: 2020,
    defaultEndYear: 2029,
  },
  {
    id: 'near_future_earth',
    eraName: 'Near-Future Earth',
    description:
      'Grounded near-future Earth projections in the mid-to-late 21st century (2030–2099)',
    defaultStartYear: 2035,
    defaultEndYear: 2085,
  },
];

function formatYearLabel(year: number): string {
  if (year < 0) {
    return `${Math.abs(year)} BCE`;
  }
  return `${year} CE`;
}

function buildChronologicalBuckets(): ChronologicalBucketDefinition[] {
  const buckets: ChronologicalBucketDefinition[] = [];

  // 1. Deep Antiquity: -10000 to -2001 in 500-year buckets (16 buckets)
  for (let y = -10000; y < -2000; y += 500) {
    const end = y + 499;
    buckets.push({
      id: `bce_${Math.abs(y)}_${Math.abs(end)}`,
      label: `${Math.abs(y)}–${Math.abs(end)} BCE`,
      startYear: y,
      endYear: end,
    });
  }

  // 2. Bronze & Iron Ages: -2000 to -501 in 100-year century buckets (15 buckets)
  for (let y = -2000; y < -500; y += 100) {
    const end = y + 99;
    buckets.push({
      id: `bce_${Math.abs(y)}_${Math.abs(end)}`,
      label: `${Math.abs(y)}–${Math.abs(end)} BCE`,
      startYear: y,
      endYear: end,
    });
  }

  // 3. Classical & Medieval: -500 to 1499 in 25-year quarter-century buckets (80 buckets)
  for (let y = -500; y < 1500; y += 25) {
    const end = y + 24;
    if (y < 0) {
      const endAbs = Math.abs(end);
      const id =
        end < 0
          ? `bce_${Math.abs(y)}_${endAbs}`
          : `bce_${Math.abs(y)}_ce_${end}`;
      buckets.push({
        id,
        label: `${formatYearLabel(y)} – ${formatYearLabel(end)}`,
        startYear: y,
        endYear: end,
      });
    } else {
      buckets.push({
        id: `ce_${y}_${end}`,
        label: `${y}–${end} CE`,
        startYear: y,
        endYear: end,
      });
    }
  }

  // 4. Early Modern through Near Future: 1500 to 2099 in exact 10-year decade buckets (60 buckets)
  for (let y = 1500; y < 2100; y += 10) {
    const end = y + 9;
    buckets.push({
      id: `decade_${y}s`,
      label: `${y}s (${y}–${end} CE)`,
      startYear: y,
      endYear: end,
    });
  }

  return buckets;
}

export const CHRONOLOGICAL_BUCKETS: readonly ChronologicalBucketDefinition[] =
  buildChronologicalBuckets();

const ERA_BY_ID = new Map<string, HistoricalEraDefinition>(
  HISTORICAL_ERAS.map(era => [era.id, era]),
);

const BUCKET_BY_ID = new Map<string, ChronologicalBucketDefinition>(
  CHRONOLOGICAL_BUCKETS.map(b => [b.id, b]),
);

export const HISTORICAL_ERA_CRITERIA: Record<string, string> =
  Object.fromEntries(
    HISTORICAL_ERAS.map(era => [era.id, `${era.eraName}: ${era.description}`]),
  );

export const CHRONOLOGICAL_BUCKET_CRITERIA: Record<string, string> =
  Object.fromEntries(
    CHRONOLOGICAL_BUCKETS.map(bucket => [bucket.id, bucket.label]),
  );

export interface ResolvedTemporalDecision {
  id: string;
  isNonHistorical: boolean;
  startYear?: number;
  endYear?: number;
  eraName?: string;
  rationale?: string;
  confidence?: number;
}

function asNoul(
  answer: DecisionAnswerPayload | undefined,
): DecisionNoulAnswer | undefined {
  return answer?.type === 'noul' ? answer : undefined;
}

function asChoice(
  answer: DecisionAnswerPayload | undefined,
): DecisionChoiceAnswer | undefined {
  return answer?.type === 'choice' ? answer : undefined;
}

export function resolveTemporalFromDecisions(
  bookId: string,
  answers: Record<string, DecisionAnswerPayload>,
  prefix: string,
  options?: {includeConfidence?: boolean},
): ResolvedTemporalDecision {
  const nonHist = asNoul(answers[`${prefix}_non_hist`]);
  if (nonHist && nonHist.noul >= 0.55) {
    return {
      id: bookId,
      isNonHistorical: true,
      ...(options?.includeConfidence
        ? {confidence: Math.min(1, Math.max(0, nonHist.noul))}
        : {}),
    };
  }

  const eraChoice = asChoice(answers[`${prefix}_era`]);
  const startChoice = asChoice(answers[`${prefix}_start`]);
  const endChoice = asChoice(answers[`${prefix}_end`]);

  const resolvedEra =
    (eraChoice ? ERA_BY_ID.get(eraChoice.choice) : undefined) ??
    HISTORICAL_ERAS.find(e => e.id === 'contemporary_era')!;

  let startBucket = startChoice
    ? BUCKET_BY_ID.get(startChoice.choice)
    : undefined;
  let endBucket = endChoice ? BUCKET_BY_ID.get(endChoice.choice) : undefined;

  if (startBucket && endBucket && endBucket.startYear < startBucket.startYear) {
    const tmp = startBucket;
    startBucket = endBucket;
    endBucket = tmp;
  }

  let startYear = startBucket
    ? startBucket.startYear
    : resolvedEra.defaultStartYear;
  let endYear = endBucket
    ? endBucket.endYear
    : startBucket
      ? startBucket.endYear
      : resolvedEra.defaultEndYear;

  if (endYear < startYear) {
    const swapped = startYear;
    startYear = endYear;
    endYear = swapped;
  }

  if (endYear - startYear > 100) {
    endYear = startYear + 100;
  }

  startYear = Math.max(-10000, Math.min(2100, startYear));
  endYear = Math.max(startYear, Math.min(2100, endYear));

  const spanText =
    startYear === endYear
      ? formatYearLabel(startYear)
      : `${formatYearLabel(startYear)}–${formatYearLabel(endYear)}`;

  const eraProb =
    eraChoice && ERA_BY_ID.has(eraChoice.choice)
      ? (eraChoice.probabilities[eraChoice.choice] ??
        eraChoice.confidence ??
        0.5)
      : 0.2;
  const histFactor = nonHist ? Math.max(0.5, 1 - nonHist.noul * 0.5) : 1;
  const calibratedConfidence = Math.min(1, Math.max(0, eraProb * histFactor));

  return {
    id: bookId,
    isNonHistorical: false,
    startYear,
    endYear,
    eraName: resolvedEra.eraName,
    rationale: `Set in the ${resolvedEra.eraName} (${spanText}).`,
    ...(options?.includeConfidence ? {confidence: calibratedConfidence} : {}),
  };
}
