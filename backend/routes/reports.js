// The XML report and its stylesheet (step 2.10).
//   GET /api/workspaces/:id/report.xml  lecturers of the course and college admins, after submission
//   GET /api/reports/report.xsl          no token: the browser fetches it to display the XML.
//                                        It is a fixed template with no data in it.
import { readFileSync } from 'node:fs';
import express from 'express';
import { fail, handler } from './http.js';
import { workspaceId as workspaceIdSchema } from './courseSchemas.js';
import { isStaff, workspaceAccess } from '../services/courses/access.js';
import { buildReportXml, loadReportData } from '../services/reports/workspaceReport.js';

const STYLESHEET = readFileSync(new URL('../reports/report.xsl', import.meta.url), 'utf8');

export function createReportRouter(ctx) {
  const { db, guard, now } = ctx;
  const router = express.Router();

  router.get('/reports/report.xsl', (_req, res) => {
    res.type('text/xsl; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(STYLESHEET);
  });

  router.get(
    '/workspaces/:workspaceId/report.xml',
    guard('lecturer', 'collegeAdmin', 'superAdmin'),
    handler(async (req, res) => {
      const parsed = workspaceIdSchema.safeParse(req.params.workspaceId);
      if (!parsed.success) throw fail(404, 'NOT_FOUND');
      const access = await workspaceAccess(db.pool, req.user, parsed.data);
      if (!isStaff(access)) throw fail(403, 'FORBIDDEN');
      const data = await loadReportData(db.pool, access.workspace.id);
      if (!data) throw fail(409, 'NOT_SUBMITTED', 'This workspace has not been submitted yet.');
      const xml = buildReportXml(data, { generatedAt: new Date(now()).toISOString() });
      res
        .type('application/xml; charset=utf-8')
        .set('Content-Disposition', `inline; filename="report-${access.workspace.id}.xml"`)
        .set('Cache-Control', 'no-store')
        .send(xml);
    })
  );

  return router;
}
