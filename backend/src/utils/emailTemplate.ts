/* utils/emailTemplate.ts */
export function fillTemplate(raw: string, vars: Record<string,string>) {
    return Object.entries(vars).reduce(
      (out,[k,v]) => out.replace(new RegExp(`{{\\s*${k}\\s*}}`,"g"), v),
      raw
    );
  }