import { z } from "zod"

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!
  ))
}

function baseTemplate(title: string, message: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #E57700; margin-bottom: 20px;">${escapeHtml(title)}</h2>
      <p style="margin-bottom: 15px;">${message}</p>
      <p style="margin-bottom: 15px;">Please log in to your dashboard to view more details.</p>
      <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
        <p style="font-size: 12px; color: #666;">This is an automated message from Chain Move. Please do not reply to this email.</p>
      </div>
    </div>
  `
}

interface EmailTemplateDefinition<TVariables> {
  variables: z.ZodType<TVariables>
  subject: (vars: TVariables) => string
  html: (vars: TVariables) => string
}

function defineTemplate<TVariables>(definition: EmailTemplateDefinition<TVariables>) {
  return definition
}

const loanApprovedVariables = z.object({
  amountLabel: z.string().trim().min(1).max(40),
})

const loanRejectedVariables = z.object({
  amountLabel: z.string().trim().min(1).max(40),
  reason: z.string().trim().max(500).optional(),
})

export const EMAIL_TEMPLATES = {
  "loan.approved": defineTemplate({
    variables: loanApprovedVariables,
    subject: () => "Loan Application Approved",
    html: (vars) =>
      baseTemplate(
        "Loan Application Approved",
        `Your loan application for ${escapeHtml(vars.amountLabel)} has been approved.`,
      ),
  }),
  "loan.rejected": defineTemplate({
    variables: loanRejectedVariables,
    subject: () => "Loan Application Rejected",
    html: (vars) =>
      baseTemplate(
        "Loan Application Rejected",
        `Your loan application for ${escapeHtml(vars.amountLabel)} has been rejected.${
          vars.reason ? ` Reason: ${escapeHtml(vars.reason)}` : ""
        }`,
      ),
  }),
} as const

export type EmailTemplateId = keyof typeof EMAIL_TEMPLATES

export function renderEmailTemplate(templateId: EmailTemplateId, variables: unknown) {
  const template = EMAIL_TEMPLATES[templateId] as EmailTemplateDefinition<any>
  const parsedVariables = template.variables.parse(variables)
  return {
    subject: template.subject(parsedVariables),
    html: template.html(parsedVariables),
  }
}
