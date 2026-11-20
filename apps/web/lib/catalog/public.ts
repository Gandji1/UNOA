import 'server-only';
import { NextResponse } from 'next/server';
import type { CurriculumModel } from '@unoa/domain/curriculum';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';

// Public data is already filtered by the database; a short cache keeps the
// directory usable on slow connections without serving stale decisions for long.
export function publicJson(body: object) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=60', 'Referrer-Policy': 'no-referrer' } });
}

export const regulatoryLabels: Record<string, string> = {
  unverified: 'Statut réglementaire non vérifié',
  preparation: 'En préparation',
  non_degree: 'Non diplômant',
  conditional: 'Autorisé sous conditions',
  authorized: 'Diplômant habilité',
  suspended: 'Suspendu',
  expired: 'Expiré',
};

export interface PublicProgram {
  program_id: string; version_id: string; version_number: number; code: string; title: string; kind_label: string;
  degree_awarding: boolean; field_label: string | null; institution_label: string; owner_label: string;
  delivery_mode: string; duration: string; languages: string[]; territories: string[];
  regulatory_status: string; admission_open: boolean; published_at: Date;
}

export async function publicPrograms(settings: IamSettings, siteId: string) {
  const { rows } = await database(settings).query<PublicProgram>('SELECT * FROM unoa.public_programs($1)', [siteId]);
  return rows;
}

export interface PublicSheet {
  program: {
    id: string; code: string; kind: string; degreeAwarding: boolean; field: string | null; institution: string; owner: string;
    regulatoryStatus: string; admissionOpen: boolean; labels: { language: string; title: string; summary: string | null }[];
  };
  version: {
    id: string; number: number; title: string; organisation: string; duration: string; deliveryMode: string;
    creditUnit: string; expectedCredits: number | null; languages: string[]; capacity: number | null;
    objectives: string | null; admission: string | null; publishedAt: string;
  };
  territories: string[];
  competencies: { code: string; label: string }[];
  requirements: { kind: string; label: string; credits: number | null; mandatory: boolean }[];
  periods: {
    ordinal: number; label: string; groups: { id: string; label: string; min: number; max: number }[];
    units: {
      id: string; code: string; title: string; credits: number; coefficient: number; groupId: string | null;
      volumes: { activity: string; hours: number }[]; courses: { code: string; title: string }[]; requires: string[];
    }[];
  }[];
}

export async function publicSheet(settings: IamSettings, siteId: string, programId: string) {
  const { rows } = await database(settings).query<{ sheet: PublicSheet | null }>(
    'SELECT unoa.public_program_sheet($1, $2) AS sheet', [siteId, programId],
  );
  return rows[0]?.sheet ?? null;
}

export function sheetModel(sheet: PublicSheet): CurriculumModel {
  return {
    periods: sheet.periods.map(period => ({ ordinal: period.ordinal, label: period.label })),
    groups: sheet.periods.flatMap(period => period.groups.map(group => ({ ...group, periodOrdinal: period.ordinal }))),
    units: sheet.periods.flatMap(period => period.units.map(unit => ({
      id: unit.id, code: unit.code, title: unit.title, periodOrdinal: period.ordinal,
      credits: Number(unit.credits), groupId: unit.groupId,
    }))),
    prerequisites: sheet.periods.flatMap(period => period.units.flatMap(unit =>
      unit.requires.map(required => ({ unitId: unit.id, requiredUnitId: required })))),
    expectedCredits: sheet.version.expectedCredits === null ? null : Number(sheet.version.expectedCredits),
  };
}

