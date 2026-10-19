<?xml version="1.0" encoding="UTF-8"?>
<!--
  Peerlytics workspace report -> printable HTML (step 2.10).

  The browser applies this stylesheet to GET /api/workspaces/{id}/report.xml (the XML names it
  in an xml-stylesheet processing instruction), or the website runs it with XSLTProcessor.
  Colours: red = sentences flagged as possibly AI-generated; yellow = large paste events.
  AI likelihood is a signal, not proof, and the page says so.

  How the XPath works (for the report write-up)
  ==============================================
  The context node inside <xsl:for-each select="students/student"> is one <student>, so
  relative paths read that student's own data and paths starting with "/" read the whole report.

  1. A student's total deductions
       sum(deductions/deduction/@points)
     deductions/deduction selects every <deduction> child of this student; /@points takes each
     one's points attribute; sum() adds them. With no deductions the node-set is empty and
     sum() returns 0, so no special case is needed.

  2. A student's share of the group's edits
       metrics/@edits div $groupEdits
     where $groupEdits = sum(/report/students/student/metrics/@edits). The absolute path starts
     at the root, so it adds every student's edits; div is XPath's division operator. The
     template multiplies by 100 and uses round() to show a whole percentage, and checks
     $groupEdits > 0 first so an empty group never divides by zero.

  3. Minutes of active writing
       round(metrics/@timeSpentSec div 60)

  4. AI flags written by this student
       count(/report/analysis/flaggedSentence[@authorRef = $id])
     The predicate [ ... ] keeps only the flagged sentences whose authorRef equals this
     student's id (held in the variable $id, because inside the predicate "." would be the
     flaggedSentence, not the student). count() gives how many.

  5. Group totals in the footer
       count(students/student)                                  number of students
       sum(students/student/metrics/@timeSpentSec) div 60       total minutes
       sum(students/student/grade/@final) div count(students/student/grade)
                                                                average final grade
       count(students/student[metrics/@largePastes > 0])        students with large pastes
     The predicate in the last one tests a number, so only students with at least one large
     paste are counted.

  6. Rows that need a colour
       metrics/@largePastes > 0   -> the row gets class "paste" (yellow)
       grade/@overridden = 'true' -> the final grade is shown as the lecturer's decision
-->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:variable name="groupEdits" select="sum(/report/students/student/metrics/@edits)"/>

  <xsl:template match="/report">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <title>Peerlytics report: <xsl:value-of select="workspace/name"/></title>
        <style>
          body { font-family: system-ui, sans-serif; color: #1f2937; margin: 24px; line-height: 1.4; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          h2 { font-size: 16px; margin: 24px 0 8px; }
          .meta { color: #4b5563; font-size: 13px; }
          table { border-collapse: collapse; width: 100%; font-size: 13px; }
          th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; }
          td.num { text-align: right; font-variant-numeric: tabular-nums; }
          tfoot td { font-weight: 600; background: #f9fafb; }
          .paste, .paste td { background: #fef08a; }
          .ai { background: #fecaca; border-left: 4px solid #dc2626; padding: 6px 8px; margin: 6px 0; }
          .notice { background: #f3f4f6; padding: 8px; font-size: 13px; }
          .legend span { display: inline-block; padding: 2px 8px; margin-right: 8px; font-size: 12px; }
          .explanation { font-size: 12px; color: #374151; }
          @media print { body { margin: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
          @page { size: A4; margin: 15mm; }
        </style>
      </head>
      <body>
        <h1><xsl:value-of select="course/@code"/>: <xsl:value-of select="assignment/title"/></h1>
        <p class="meta">
          Group <strong><xsl:value-of select="workspace/name"/></strong>
          · <xsl:value-of select="course/title"/>
          · submitted <xsl:value-of select="workspace/@submittedAt"/>
          (<xsl:value-of select="workspace/@trigger"/>, <xsl:value-of select="workspace/@wordCount"/> words)
          · rubric: time <xsl:value-of select="assignment/rubric/@time"/>,
          edits <xsl:value-of select="assignment/rubric/@edits"/>,
          writing <xsl:value-of select="assignment/rubric/@writing"/>,
          tasks <xsl:value-of select="assignment/rubric/@tasks"/>
        </p>
        <p class="legend">
          <span class="ai">Red: possibly AI-generated</span>
          <span class="paste">Yellow: large pastes</span>
        </p>

        <h2>Students</h2>
        <table>
          <thead>
            <tr>
              <th>Student</th><th>Minutes</th><th>Edits</th><th>Share of edits</th><th>Large pastes</th>
              <th>AI flags</th><th>Time</th><th>Edits score</th><th>Writing</th><th>Tasks</th>
              <th>Deductions</th><th>Suggested</th><th>Final</th>
            </tr>
          </thead>
          <tbody>
            <xsl:for-each select="students/student">
              <xsl:variable name="id" select="@id"/>
              <tr>
                <xsl:if test="metrics/@largePastes &gt; 0">
                  <xsl:attribute name="class">paste</xsl:attribute>
                </xsl:if>
                <td><xsl:value-of select="name"/></td>
                <td class="num"><xsl:value-of select="round(metrics/@timeSpentSec div 60)"/></td>
                <td class="num"><xsl:value-of select="metrics/@edits"/></td>
                <td class="num">
                  <xsl:choose>
                    <xsl:when test="$groupEdits &gt; 0"><xsl:value-of select="round(metrics/@edits div $groupEdits * 100)"/>%</xsl:when>
                    <xsl:otherwise>–</xsl:otherwise>
                  </xsl:choose>
                </td>
                <td class="num"><xsl:value-of select="metrics/@largePastes"/></td>
                <td class="num"><xsl:value-of select="count(/report/analysis/flaggedSentence[@authorRef = $id])"/></td>
                <td class="num"><xsl:value-of select="scores/@time"/></td>
                <td class="num"><xsl:value-of select="scores/@edits"/></td>
                <td class="num">
                  <xsl:choose>
                    <xsl:when test="scores/@writing"><xsl:value-of select="scores/@writing"/></xsl:when>
                    <xsl:otherwise>n/a</xsl:otherwise>
                  </xsl:choose>
                </td>
                <td class="num">
                  <xsl:choose>
                    <xsl:when test="scores/@tasks"><xsl:value-of select="scores/@tasks"/></xsl:when>
                    <xsl:otherwise>n/a</xsl:otherwise>
                  </xsl:choose>
                </td>
                <td class="num">
                  <xsl:choose>
                    <xsl:when test="sum(deductions/deduction/@points) &gt; 0">−<xsl:value-of select="sum(deductions/deduction/@points)"/></xsl:when>
                    <xsl:otherwise>0</xsl:otherwise>
                  </xsl:choose>
                </td>
                <td class="num"><xsl:value-of select="grade/@suggested"/></td>
                <td class="num">
                  <strong><xsl:value-of select="grade/@final"/></strong>
                  <xsl:if test="grade/@overridden = 'true'"> (lecturer)</xsl:if>
                </td>
              </tr>
            </xsl:for-each>
          </tbody>
          <tfoot>
            <tr>
              <td><xsl:value-of select="count(students/student)"/> students</td>
              <td class="num"><xsl:value-of select="round(sum(students/student/metrics/@timeSpentSec) div 60)"/></td>
              <td class="num"><xsl:value-of select="$groupEdits"/></td>
              <td class="num">100%</td>
              <td class="num"><xsl:value-of select="count(students/student[metrics/@largePastes &gt; 0])"/> with pastes</td>
              <td class="num"><xsl:value-of select="count(analysis/flaggedSentence)"/></td>
              <td colspan="6">Average final grade</td>
              <td class="num">
                <xsl:if test="count(students/student/grade) &gt; 0">
                  <xsl:value-of select="round(sum(students/student/grade/@final) div count(students/student/grade) * 100) div 100"/>
                </xsl:if>
              </td>
            </tr>
          </tfoot>
        </table>

        <h2>Why each grade</h2>
        <xsl:for-each select="students/student[explanation]">
          <p class="explanation">
            <strong><xsl:value-of select="name"/>:</strong>
            <xsl:text> </xsl:text><xsl:value-of select="explanation"/>
            <xsl:for-each select="grade/override">
              <br/>Lecturer override by <xsl:value-of select="@by"/> (<xsl:value-of select="@at"/>): <xsl:value-of select="reason"/>
            </xsl:for-each>
          </p>
        </xsl:for-each>

        <h2>AI analysis</h2>
        <xsl:choose>
          <xsl:when test="analysis">
            <p class="notice"><xsl:value-of select="analysis/notice"/></p>
            <p class="meta">
              Provider <xsl:value-of select="analysis/@provider"/> (<xsl:value-of select="analysis/@status"/>)
              <xsl:if test="analysis/@aiLikelihood"> · AI likelihood <xsl:value-of select="analysis/@aiLikelihood"/>/100</xsl:if>
              <xsl:if test="analysis/@writingQuality"> · writing quality <xsl:value-of select="analysis/@writingQuality"/>/10</xsl:if>
            </p>
            <xsl:for-each select="analysis/flaggedSentence">
              <xsl:variable name="ref" select="@authorRef"/>
              <div class="ai">
                <xsl:value-of select="sentence"/>
                <br/><small>
                  <xsl:value-of select="reason"/>
                  <xsl:if test="$ref"> · written by <xsl:value-of select="/report/students/student[@id = $ref]/name"/></xsl:if>
                </small>
              </div>
            </xsl:for-each>
            <xsl:if test="not(analysis/flaggedSentence)"><p>No sentences were flagged.</p></xsl:if>
          </xsl:when>
          <xsl:otherwise><p>No analysis was available for this submission.</p></xsl:otherwise>
        </xsl:choose>

        <p class="meta">Generated <xsl:value-of select="@generatedAt"/> by Peerlytics. The lecturer's override is final.</p>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
