import { parsePatientMasterWorkbook, type PatientMasterParseResult } from '@/lib/patient-master-parser';
import { PatientMasterRepository, type PatientMasterImportCounts, type PatientMasterRecord, type PatientMasterStats } from '@/lib/patient-master-repository';

export interface PatientMasterUploadSummary extends PatientMasterParseResult {
  inserted: number;
  updated: number;
  durationMs: number;
}

export class PatientMasterService {
  static previewPatientMaster(buffer: Buffer): PatientMasterParseResult {
    return parsePatientMasterWorkbook(buffer);
  }

  static async uploadPatientMaster(buffer: Buffer): Promise<PatientMasterUploadSummary> {
    const started = Date.now();
    const parsed = parsePatientMasterWorkbook(buffer);
    if (parsed.errors.length) {
      return { ...parsed, inserted: 0, updated: 0, durationMs: Date.now() - started };
    }

    const counts: PatientMasterImportCounts = await PatientMasterRepository.upsertRows(parsed.rows);
    return {
      ...parsed,
      inserted: counts.inserted,
      updated: counts.updated,
      durationMs: Date.now() - started,
    };
  }

  static getPatient(patientId: string | number): Promise<PatientMasterRecord | null> {
    return PatientMasterRepository.getPatient(patientId);
  }

  static getRiskCarrier(patientId: string | number): Promise<string | null> {
    return PatientMasterRepository.getRiskCarrier(patientId);
  }

  static getAllRiskCarriers(): Promise<string[]> {
    return PatientMasterRepository.getAllRiskCarriers();
  }

  static getStats(): Promise<PatientMasterStats> {
    return PatientMasterRepository.getStats();
  }
}
