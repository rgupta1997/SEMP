// Deterministic personalized name generation for demo sandboxes. Everything is
// seeded by the sandbox slug so a Reset regenerates the exact same names (with
// fresh row ids) - the client sees an identical demo after every reset.

import { createHash, randomBytes } from 'node:crypto';
import { DEMO_TEAM_SUFFIXES } from '@semp/shared';

const FIRST_NAMES = [
  'Rahul', 'Priya', 'Arjun', 'Sneha', 'Vikram', 'Ananya', 'Rohan', 'Kavya',
  'Aditya', 'Meera', 'Karan', 'Divya', 'Nikhil', 'Pooja', 'Sanjay', 'Ishita',
  'Amit', 'Neha', 'Varun', 'Riya', 'Siddharth', 'Tanvi', 'Manish', 'Shreya',
  'Deepak', 'Anjali', 'Harsh', 'Nandini', 'Gaurav', 'Aditi', 'Rajesh', 'Swati',
  'Akash', 'Lakshmi', 'Vivek', 'Sakshi', 'Pranav', 'Ritika', 'Suresh', 'Bhavna',
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Reddy', 'Iyer', 'Khan', 'Singh', 'Nair', 'Gupta',
  'Joshi', 'Mehta', 'Rao', 'Desai', 'Kulkarni', 'Bose', 'Chopra',
  'Verma', 'Menon', 'Pillai', 'Agarwal', 'Kapoor', 'Malhotra', 'Shetty',
  'Banerjee', 'Mishra', 'Chauhan',
];

// "Tata" -> "tata"; "Aditya Birla Group" -> "aditya-birla-group"
export function slugifyClient(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client';
}

// Namespace for slugs / org codes: unique per sandbox even for the same client name.
export function makeSandboxSlug(clientName: string): string {
  return `${slugifyClient(clientName)}-${randomBytes(3).toString('hex').slice(0, 4)}`;
}

// All demo logins live on the client's own (never-mailed) domain: rahul.sharma@tata.com.
export function emailDomainFor(clientName: string): string {
  return `${slugifyClient(clientName).replace(/-/g, '')}.com`;
}

// Memorable throwaway password shared by the sandbox's staff logins.
export function generateDemoPassword(): string {
  return `Demo-${randomBytes(4).toString('hex')}-${Math.floor(Math.random() * 90) + 10}`;
}

// mulberry32: tiny deterministic PRNG; seeded from the sandbox slug.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoPerson { name: string; email: string }

export interface NamePool {
  /** Next generated person; custom stakeholder names are consumed first. */
  person(): DemoPerson;
  /** Email on the client domain for an arbitrary local part (organiser/officials/POCs). */
  email(localPart: string): string;
  /** Client-branded team name for the i-th org, e.g. "Tata Strikers". */
  teamName(orgIndex: number): string;
}

export function makeNamePool(slug: string, clientName: string, emailDomain: string, customNames: string[] = []): NamePool {
  const seed = parseInt(createHash('sha256').update(slug).digest('hex').slice(0, 8), 16);
  const rand = mulberry32(seed);
  const usedEmails = new Set<string>();
  const custom = [...customNames];

  const email = (localPart: string): string => {
    const base = localPart.toLowerCase().replace(/[^a-z0-9.]+/g, '.').replace(/^\.+|\.+$/g, '') || 'user';
    let candidate = `${base}@${emailDomain}`;
    for (let n = 2; usedEmails.has(candidate); n++) candidate = `${base}${n}@${emailDomain}`;
    usedEmails.add(candidate);
    return candidate;
  };

  const person = (): DemoPerson => {
    const name = custom.length
      ? custom.shift()!
      : `${FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]}`;
    return { name, email: email(name.split(/\s+/).join('.')) };
  };

  const teamName = (orgIndex: number): string =>
    `${clientName} ${DEMO_TEAM_SUFFIXES[orgIndex % DEMO_TEAM_SUFFIXES.length]}`;

  return { person, email, teamName };
}
