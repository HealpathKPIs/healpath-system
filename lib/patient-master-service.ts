import { parsePatientMasterWorkbook, type PatientMasterParseResult } from '@/lib/patient-master-parser';
import { PatientMasterRepository, type PatientMasterImportCounts, type PatientMasterRecord, type PatientMasterStats } from '@/lib/patient-master-repository';

export interface PatientMasterUploadSummary extends PatientMasterParseResult {
  inserted: number;
  updated: number;
  durationMs: number;
}

export class PatientMasterService {
  constructor(private readonly repository: PatientMasterRepository = new PatientMasterRepository()) {}

  previewPatientMaster(buffer: Buffer): PatientMasterParseResult {
    return parsePatientMasterWorkbook(buffer);
  }

  async uploadPatientMaster(buffer: Buffer): Promise<PatientMasterUploadSummary> {
    const started = Date.now();
    const parsed = parsePatientMasterWorkbook(buffer);
    if (parsed.errors.length) {
      return { ...parsed, inserted: 0, updated: 0, durationMs: Date.now() - started };
    }

    const counts: PatientMasterImportCounts = await this.repository.upsertRows(parsed.rows);
    return {
      ...parsed,
      inserted: counts.inserted,
      updated: counts.updated,
      durationMs: Date.now() - started,
    };
  }

  getPatient(patientId: string | number): Promise<PatientMasterRecord | null> {
    return this.repository.getPatient(patientId);
  }

  getRiskCarrier(patientId: string | number): Promise<string | null> {
    return this.repository.getRiskCarrier(patientId);
  }

  getAllRiskCarriers(): Promise<string[]> {
    return this.repository.getAllRiskCarriers();
  }

  getStats(): Promise<PatientMasterStats> {
    return this.repository.getStats();
  }

  private static readonly defaultService = new PatientMasterService();

  static previewPatientMaster(buffer: Buffer): PatientMasterParseResult {
    return this.defaultService.previewPatientMaster(buffer);
  }

  static uploadPatientMaster(buffer: Buffer): Promise<PatientMasterUploadSummary> {
    return this.defaultService.uploadPatientMaster(buffer);
  }

  static getPatient(patientId: string | number): Promise<PatientMasterRecord | null> {
    return this.defaultService.getPatient(patientId);
  }

  static getRiskCarrier(patientId: string | number): Promise<string | null> {
    return this.defaultService.getRiskCarrier(patientId);
  }

  static getAllRiskCarriers(): Promise<string[]> {
    return this.defaultService.getAllRiskCarriers();
  }

  static getStats(): Promise<PatientMasterStats> {
    return this.defaultService.getStats();
  }
}
