import { IntakeEnqueueService } from './intake-enqueue.service';

describe('IntakeEnqueueService atomic cleanup', () => {
  it('deletes the final file when the transaction fails after final move', async () => {
    const finalRef = 'final-storage-ref';
    const storage = {
      writeTemp: jest.fn().mockResolvedValue('temp-file'),
      computeChecksum: jest.fn().mockReturnValue('checksum'),
      moveToFinal: jest.fn().mockResolvedValue(finalRef),
      deleteTemp: jest.fn().mockResolvedValue(undefined),
      deleteFinal: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      intakeJob: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('forced tx failure')),
    };
    const service = new IntakeEnqueueService(prisma as any, storage as any);

    await expect(
      service.enqueueUpload({
        fileName: 'acceptance.xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 4,
        bytes: Buffer.from('test'),
        workspaceId: 'workspace-id',
        organizationId: 'organization-id',
        uploadedByAccountId: 'account-id',
      }),
    ).rejects.toThrow('forced tx failure');

    expect(storage.deleteFinal).toHaveBeenCalledWith(finalRef);
    expect(storage.deleteTemp).toHaveBeenCalledWith(null);
  });
});
