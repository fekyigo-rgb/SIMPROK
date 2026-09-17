import {
  Controller,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import request from 'supertest';
import { AHSP_DOCUMENT_UPLOAD_OPTIONS } from './ahsp.controller';
import { AHSP_DOCUMENT_MAX_BYTES } from './services/ahsp-document-canonicalization.service';

/**
 * TRUST REPAIR — the source file name of an AHSP upload is provenance, and it must
 * reach SIMPROK exactly as the reader named it.
 *
 * Captured on the wire: Chromium, Node fetch and superagent all write the name as
 * raw UTF-8 bytes in `filename="..."` and never send `filename*`. The bodies below
 * are built the same way, and go through the REAL FileInterceptor, multer and busboy
 * the AHSP routes use — with the routes' own options.
 */

type UploadedProbeFile = { originalname: string; buffer: Buffer };
type Received = { originalname: string; sha256: string };

const receive = (file: UploadedProbeFile): Received => ({
  originalname: file.originalname,
  sha256: createHash('sha256').update(file.buffer).digest('hex'),
});

@Controller('upload-probe')
class UploadProbeController {
  @Post('ahsp')
  @UseInterceptors(FileInterceptor('file', AHSP_DOCUMENT_UPLOAD_OPTIONS))
  ahsp(@UploadedFile() file: UploadedProbeFile): Received {
    return receive(file);
  }

  /** B0 anchor: the options both AHSP document routes declared before the repair. */
  @Post('before')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AHSP_DOCUMENT_MAX_BYTES } }),
  )
  before(@UploadedFile() file: UploadedProbeFile): Received {
    return receive(file);
  }
}

const cp = (...points: number[]) => String.fromCodePoint(...points);
const EM_DASH = cp(0x2014);
const EN_DASH = cp(0x2013);
const NAMES = {
  ascii: 'AHSP Owner Proof.xlsx',
  emDash: `DATA UJI ${EM_DASH} AHSP OWNER.xlsx`,
  punctuation: `AHSP ${EN_DASH} Pekerjaan Gedung (Rev. 2), ${cp(0x2018)}final${cp(0x2019)} & catatan${cp(0x2026)}.xlsx`,
  accented: `Analisis caf${cp(0xe9)} ${cp(0xd1)}ame.xlsx`,
  decomposed: `Analisis cafe${cp(0x301)}.xlsx`,
  nonLatin: `${cp(0x6e2c, 0x8a66)} ${cp(0x0623, 0x0633, 0x0627, 0x0633)}.xlsx`,
};

const BOUNDARY = '----WebKitFormBoundarySimprokUploadProbe';
const CONTENT = Buffer.from(
  Array.from({ length: 4096 }, (_, index) => (index * 37 + 11) % 256),
);
const CONTENT_SHA256 = createHash('sha256').update(CONTENT).digest('hex');

function multipart(filenameParam: Buffer) {
  return {
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    body: Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; `,
        'latin1',
      ),
      filenameParam,
      Buffer.from(
        '\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n',
        'latin1',
      ),
      CONTENT,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'latin1'),
    ]),
  };
}

/** The name as every captured client sends it: raw UTF-8 bytes inside the quotes. */
const browserParam = (name: string) =>
  Buffer.concat([
    Buffer.from('filename="', 'latin1'),
    Buffer.from(name, 'utf8'),
    Buffer.from('"', 'latin1'),
  ]);

/** RFC 5987: a name that arrives already decoded through its declared charset. */
const extendedParam = (name: string) =>
  Buffer.from(`filename*=UTF-8''${encodeURIComponent(name)}`, 'latin1');

describe('AHSP document upload — the source file name as the reader named it', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const send = async (
    route: 'ahsp' | 'before',
    filenameParam: Buffer,
  ): Promise<Received> => {
    const { contentType, body } = multipart(filenameParam);
    const response = await request(app.getHttpServer() as never)
      .post(`/upload-probe/${route}`)
      .set('Content-Type', contentType)
      .send(body)
      .expect(201);
    return response.body as Received;
  };

  it.each([
    ['ASCII', NAMES.ascii],
    ['an em dash', NAMES.emDash],
    ['an en dash and common punctuation', NAMES.punctuation],
    ['accented Latin', NAMES.accented],
    ['a decomposed accent, never normalized', NAMES.decomposed],
    ['a non-Latin script', NAMES.nonLatin],
  ])('keeps %s exactly as the browser sent it', async (_label, name) => {
    const received = await send('ahsp', browserParam(name));
    expect(received.originalname).toBe(name);
    expect(received.originalname.endsWith('.xlsx')).toBe(true);
    expect(received.sha256).toBe(CONTENT_SHA256);
  });

  it('B0 (flipped): the same bytes read with the old options became one character per UTF-8 byte', async () => {
    const before = await send('before', browserParam(NAMES.emDash));
    // Anchor — what ahsp_import_jobs.sourceFileName used to hold for this name.
    expect(before.originalname).toBe(
      Buffer.from(NAMES.emDash, 'utf8').toString('latin1'),
    );
    expect(before.originalname).not.toBe(NAMES.emDash);
    const repaired = await send('ahsp', browserParam(NAMES.emDash));
    expect(repaired.originalname).toBe(NAMES.emDash);
    // The file itself is untouched by either reading.
    expect(before.sha256).toBe(CONTENT_SHA256);
    expect(repaired.sha256).toBe(CONTENT_SHA256);
  });

  it('reads an ASCII name identically under the old and the repaired options', async () => {
    const before = await send('before', browserParam(NAMES.ascii));
    const repaired = await send('ahsp', browserParam(NAMES.ascii));
    expect(repaired.originalname).toBe(before.originalname);
  });

  it('never decodes a second time a name that arrives already decoded', async () => {
    const unicode = `AHSP${EM_DASH}Pekerjaan ${cp(0x6e2c, 0x8a66)}.xlsx`;
    expect((await send('ahsp', extendedParam(unicode))).originalname).toBe(
      unicode,
    );
    // Latin-1 characters that happen to spell UTF-8 bytes stay exactly as sent.
    const lookalike = `Laporan ${cp(0xc3, 0xa9)}.xlsx`;
    expect((await send('ahsp', extendedParam(lookalike))).originalname).toBe(
      lookalike,
    );
  });
});
