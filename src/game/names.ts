/**
 * Noms des pilotes et immatriculations des avions.
 */
import { pick, randInt, type Rng } from './rng';

// ───────────────────────── Prénoms et noms par région ─────────────────────────

interface NamePool {
  first: string[];
  last: string[];
}

const POOLS: Record<string, NamePool> = {
  fr: {
    first: ['Camille', 'Léa', 'Manon', 'Chloé', 'Inès', 'Sarah', 'Julie', 'Claire', 'Emma', 'Louise', 'Lucas', 'Hugo', 'Louis', 'Thomas', 'Nathan', 'Julien', 'Antoine', 'Maxime', 'Gabriel', 'Mathis', 'Yanis', 'Karim', 'Amina', 'Élodie', 'Nicolas', 'Pauline'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyer', 'Garnier', 'Chevalier', 'Le Gall'],
  },
  en: {
    first: ['Olivia', 'Emily', 'Sophie', 'Grace', 'Hannah', 'Megan', 'Jessica', 'Lauren', 'James', 'Oliver', 'Jack', 'Harry', 'William', 'Daniel', 'Michael', 'Ethan', 'Ryan', 'Chris', 'Liam', 'Noah'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Taylor', 'Wilson', 'Davies', 'Evans', 'Thompson', 'Walker', 'Wright', 'Robinson', 'Clarke', 'Hughes', 'Miller', 'Anderson', 'Murphy', 'Kelly', 'Campbell', 'Stewart'],
  },
  es: {
    first: ['Lucía', 'María', 'Paula', 'Valentina', 'Camila', 'Sofía', 'Isabela', 'Ana', 'Mateo', 'Santiago', 'Diego', 'Pablo', 'Javier', 'Alejandro', 'Joao', 'Pedro', 'Rafael', 'Gabriela', 'Carlos', 'Luis'],
    last: ['García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Díaz', 'Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Ramírez', 'Torres', 'Flores', 'Rojas', 'Herrera'],
  },
  de: {
    first: ['Anna', 'Lena', 'Mia', 'Laura', 'Lisa', 'Katharina', 'Jonas', 'Felix', 'Lukas', 'Leon', 'Paul', 'Maximilian', 'Tobias', 'Jan', 'Lars', 'Sven', 'Ingrid', 'Erik', 'Pieter', 'Sanne'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Richter', 'Klein', 'Wolf', 'de Vries', 'Jansen', 'Andersen', 'Nielsen', 'Larsen', 'Berg'],
  },
  ar: {
    first: ['Fatima', 'Aisha', 'Mariam', 'Layla', 'Noor', 'Salma', 'Yasmin', 'Omar', 'Ahmed', 'Mohamed', 'Youssef', 'Ali', 'Khalid', 'Hassan', 'Tarek', 'Rania', 'Samir', 'Karim', 'Nadia', 'Bilal'],
    last: ['Al-Mansouri', 'Haddad', 'Khoury', 'Benali', 'El Amrani', 'Saleh', 'Nasser', 'Farouk', 'Hamdan', 'Rahman', 'Aziz', 'Mansour', 'Bakr', 'Kassem', 'Darwish', 'Yilmaz', 'Demir', 'Kaya', 'Şahin', 'Öztürk'],
  },
  af: {
    first: ['Amara', 'Ngozi', 'Chiamaka', 'Aminata', 'Fatou', 'Zainab', 'Thandiwe', 'Adaeze', 'Kwame', 'Kofi', 'Chinedu', 'Tunde', 'Moussa', 'Ibrahima', 'Sipho', 'Abebe', 'Oluwaseun', 'Mamadou', 'Awa', 'Yaw'],
    last: ['Okafor', 'Adeyemi', 'Mensah', 'Diallo', 'Traoré', 'Ndiaye', 'Mbeki', 'Okonkwo', 'Asante', 'Kamara', 'Diop', 'Keita', 'Banda', 'Mwangi', 'Tesfaye', 'Nkosi', 'Coulibaly', 'Sow', 'Boateng', 'Eze'],
  },
  in: {
    first: ['Priya', 'Ananya', 'Aditi', 'Kavya', 'Neha', 'Divya', 'Sneha', 'Arjun', 'Rohan', 'Vikram', 'Rahul', 'Aditya', 'Karan', 'Siddharth', 'Imran', 'Farhan', 'Ayesha', 'Ravi', 'Sanjay', 'Meera'],
    last: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Reddy', 'Iyer', 'Nair', 'Mehta', 'Joshi', 'Das', 'Chopra', 'Rao', 'Khan', 'Malik', 'Ahmed', 'Bose', 'Menon', 'Verma', 'Kapoor'],
  },
  ea: {
    first: ['Mei', 'Yuki', 'Hana', 'Sakura', 'Ji-woo', 'Min-ji', 'Lan', 'Linh', 'Wei', 'Hao', 'Jun', 'Hiroshi', 'Kenji', 'Takumi', 'Min-jun', 'Seo-yeon', 'Bao', 'Siti', 'Arif', 'Nattapong'],
    last: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Kim', 'Lee', 'Park', 'Nguyen', 'Tran', 'Santoso', 'Wongsakul', 'Tan'],
  },
  ru: {
    first: ['Anastasia', 'Maria', 'Daria', 'Olga', 'Elena', 'Natalia', 'Ivan', 'Dmitri', 'Alexei', 'Sergei', 'Nikolai', 'Andrei', 'Mikhail', 'Pavel', 'Katarzyna', 'Piotr', 'Tomasz', 'Ioana', 'Andrei', 'Yulia'],
    last: ['Ivanov', 'Smirnov', 'Kuznetsov', 'Popov', 'Volkov', 'Sokolov', 'Lebedev', 'Kozlov', 'Novak', 'Kowalski', 'Nowak', 'Wiśniewski', 'Popescu', 'Ionescu', 'Horváth', 'Kovač', 'Petrov', 'Shevchenko', 'Bondarenko', 'Dvořák'],
  },
};

/** Pays parlant ces langues ou de ces régions (sinon on se sert du continent). */
const COUNTRY_POOL: Record<string, string> = {
  FR: 'fr', BE: 'fr', CH: 'fr', LU: 'fr', MC: 'fr', SN: 'af', CI: 'af', CM: 'af', ML: 'af', MG: 'af', RE: 'fr', GP: 'fr', MQ: 'fr', GF: 'fr', PF: 'fr', NC: 'fr', HT: 'fr', CA: 'en',
  US: 'en', GB: 'en', IE: 'en', AU: 'en', NZ: 'en', ZA: 'af', NG: 'af', GH: 'af', KE: 'af', ET: 'af',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', BR: 'es', PT: 'es', VE: 'es', EC: 'es', CU: 'es', DO: 'es',
  DE: 'de', AT: 'de', NL: 'de', DK: 'de', SE: 'de', NO: 'de', FI: 'de', IS: 'de',
  MA: 'ar', DZ: 'ar', TN: 'ar', EG: 'ar', SA: 'ar', AE: 'ar', QA: 'ar', KW: 'ar', OM: 'ar', JO: 'ar', LB: 'ar', TR: 'ar', IQ: 'ar', BH: 'ar',
  IN: 'in', PK: 'in', BD: 'in', LK: 'in', NP: 'in',
  CN: 'ea', JP: 'ea', KR: 'ea', TW: 'ea', HK: 'ea', VN: 'ea', TH: 'ea', ID: 'ea', MY: 'ea', SG: 'ea', PH: 'ea',
  RU: 'ru', UA: 'ru', PL: 'ru', CZ: 'ru', RO: 'ru', HU: 'ru', BG: 'ru', HR: 'ru', RS: 'ru', SK: 'ru', BY: 'ru', KZ: 'ru',
};

const CONTINENT_POOL: Record<string, string> = { EU: 'de', AF: 'af', AS: 'ea', NA: 'en', SA: 'es', OC: 'en' };

export function namePoolFor(country: string, continent: string | undefined): string {
  return COUNTRY_POOL[country] ?? CONTINENT_POOL[continent ?? ''] ?? 'en';
}

export function randomName(rng: Rng, pool: string): { firstName: string; lastName: string } {
  const p = POOLS[pool] ?? POOLS.en;
  const firstName = pick(rng, p.first);
  let lastName = pick(rng, p.last);
  // Certains prénoms sont aussi des noms de famille : pas de « Thomas Thomas ».
  for (let i = 0; i < 5 && lastName === firstName; i++) lastName = pick(rng, p.last);
  return { firstName, lastName };
}

// ───────────────────────── Immatriculations ─────────────────────────

/** Préfixes d'immatriculation (OACI) des principaux pays. */
const REG_PREFIX: Record<string, string> = {
  FR: 'F-', US: 'N', GB: 'G-', DE: 'D-', ES: 'EC-', IT: 'I-', PT: 'CS-', BE: 'OO-', NL: 'PH-', CH: 'HB-', AT: 'OE-', IE: 'EI-', LU: 'LX-',
  DK: 'OY-', SE: 'SE-', NO: 'LN-', FI: 'OH-', IS: 'TF-', PL: 'SP-', CZ: 'OK-', GR: 'SX-', TR: 'TC-', RU: 'RA-', UA: 'UR-', RO: 'YR-', HU: 'HA-',
  CA: 'C-', MX: 'XA-', BR: 'PR-', AR: 'LV-', CL: 'CC-', CO: 'HK-', PE: 'OB-', CN: 'B-', JP: 'JA', KR: 'HL', TW: 'B-', HK: 'B-', IN: 'VT-',
  AU: 'VH-', NZ: 'ZK-', ZA: 'ZS-', EG: 'SU-', MA: 'CN-', DZ: '7T-', TN: 'TS-', SN: '6V-', NG: '5N-', KE: '5Y-', ET: 'ET-', AE: 'A6-',
  QA: 'A7-', SA: 'HZ-', IL: '4X-', SG: '9V-', MY: '9M-', TH: 'HS-', ID: 'PK-', PH: 'RP-', VN: 'VN-', PK: 'AP-',
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function letters(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += LETTERS[Math.floor(rng() * 26)];
  return s;
}

/** Nouvelle immatriculation, différente de celles déjà utilisées. */
export function randomRegistration(rng: Rng, country: string, taken: Set<string>): string {
  const prefix = REG_PREFIX[country] ?? `${country}-`;
  for (let i = 0; i < 1000; i++) {
    let reg: string;
    if (prefix === 'N') reg = `N${randInt(rng, 100, 999)}${letters(rng, 2)}`;
    else if (prefix === 'JA') reg = `JA${randInt(rng, 100, 999)}${letters(rng, 1)}`;
    else if (prefix === 'HL' || prefix === 'B-') reg = `${prefix}${randInt(rng, 1000, 9999)}`;
    else reg = `${prefix}${letters(rng, prefix.length >= 4 ? 3 : 4)}`;
    if (!taken.has(reg)) return reg;
  }
  return `${prefix}${Date.now() % 100000}`;
}
