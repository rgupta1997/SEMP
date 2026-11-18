// AUTO-DERIVED from ./templates/schedule-live.html — the "fixtures are live" player
// email. Embedded as a string (not read from disk) so it ships inside the Lambda
// bundle, which esbuilds TS only. If you edit the .html, regenerate this constant.
//
// Placeholders are {{snake_case}}; renderScheduleLiveEmail fills them and throws if
// any are left, so a template edit that adds a field fails loudly rather than mailing
// a literal "{{foo}}". Raw-HTML send verified against the mail service 2026-11-10.

export interface ScheduleLiveVars {
  event_name: string;
  event_dates: string;
  event_venue: string;
  stat_1_value: string; stat_1_label: string;
  stat_2_value: string; stat_2_label: string;
  stat_3_value: string; stat_3_label: string;
  first_name: string;
  schedule_link: string;
  organiser_name: string;
}

const TEMPLATE = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{event_name}} - Your schedule is live</title>
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet"><!--<![endif]-->
<style>
  body{margin:0;padding:0;background:#EDF0F7}
  a{text-decoration:none}
  .nw{white-space:nowrap}
  @media (max-width:620px){
    .wrap{width:100%!important}
    .px{padding-left:18px!important;padding-right:18px!important}
    .pin{padding-left:16px!important;padding-right:16px!important}
    .h1{font-size:22px!important;line-height:28px!important}
    .col{display:block!important;width:100%!important;padding:0 0 8px!important}
    .cta{padding:15px 24px!important;letter-spacing:1px!important;font-size:13px!important;white-space:nowrap!important}
    .dbr{display:none!important}
    .intro{font-size:13px!important;line-height:21px!important}
    .sm{font-size:10px!important;letter-spacing:0.6px!important}
  }
</style>
<!-- Dark mode lives in its own <style> blocks: Gmail drops a WHOLE block when it
     dislikes any rule in it, and it must never take the mobile layout above with it.
     The navy header, footer and CTA are dark BY DESIGN; these re-assert their colours.
     - prefers-color-scheme: Apple Mail / iOS Mail, Outlook for Mac.
     - [data-ogsc]/[data-ogsb]: Outlook.com and Outlook apps (NOT Gmail).
     - Gmail ignores both, see the next block. -->
<style>
  :root{color-scheme:light;supported-color-schemes:light}
  @media (prefers-color-scheme:dark){
    .darkbg{background-color:#0B1E5B!important}
    .ondark,.ondark a{color:#ffffff!important}
    .ondark-sub{color:#D6DEF8!important}
    .ondark-faint{color:#9FB2EE!important}
    .cta-a{color:#ffffff!important}
  }
  [data-ogsb] .darkbg{background-color:#0B1E5B!important}
  [data-ogsc] .ondark,[data-ogsc] .ondark a{color:#ffffff!important}
  [data-ogsc] .ondark-sub{color:#D6DEF8!important}
  [data-ogsc] .ondark-faint{color:#9FB2EE!important}
  [data-ogsc] .cta-a{color:#ffffff!important}
</style>
<!-- Gmail iOS force-inverts dark mode and turns light text dark. "u + .body" only
     matches inside Gmail (it wraps the body in <u></u><div class="body">); the nested
     screen + difference blend layers flip the inverted text back to light. -->
<style>
  u + .body .gm-screen{background:#000;mix-blend-mode:screen}
  u + .body .gm-diff{background:#000;mix-blend-mode:difference}
</style>
</head>
<body class="body" style="margin:0;padding:0;background:#EDF0F7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
  Fixtures are out for {{event_name}}. Log in to see the full schedule, venues and live scores.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDF0F7;">
<tr><td align="center" style="padding:24px 10px;">

  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">

    <!-- Header -->
    <tr><td class="px darkbg" bgcolor="#0B1E5B" style="background:#0B1E5B;background-image:linear-gradient(120deg,#081646 0%,#0B1E5B 55%,#1A3594 100%);padding:22px 36px;font-family:Montserrat,Arial,sans-serif;">
      <a class="ondark" href="{{schedule_link}}" target="_blank" style="font-size:26px;line-height:30px;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;color:#ffffff;"><span class="gm-screen"><span class="gm-diff">{{event_name}}</span></span></a>
      <p class="ondark-sub" style="margin:8px 0 0;font-size:13px;font-weight:600;color:#D6DEF8;"><span class="gm-screen"><span class="gm-diff"><span class="nw">{{event_dates}}</span> &nbsp;|&nbsp; <span class="nw">{{event_venue}}</span></span></span></p>
      <p class="sm ondark-faint" style="margin:6px 0 0;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9FB2EE;"><span class="gm-screen"><span class="gm-diff"><span class="nw">{{stat_1_value}} {{stat_1_label}}</span> &nbsp;·&nbsp; <span class="nw">{{stat_2_value}} {{stat_2_label}}</span> &nbsp;·&nbsp; <span class="nw">{{stat_3_value}} {{stat_3_label}}</span></span></span></p>
    </td></tr>

    <!-- Greeting -->
    <tr><td class="px" style="padding:26px 36px 0;font-family:Montserrat,Arial,sans-serif;">
      <h1 class="h1" style="margin:0 0 10px;font-size:25px;line-height:31px;font-weight:900;text-transform:uppercase;color:#0B1E5B;">Hi {{first_name}},<br>the fixtures are live.</h1>
      <p class="intro" style="margin:0;font-size:14px;line-height:23px;color:#4A5372;">The full schedule for {{event_name}} is out and your account is ready.<br class="dbr"> Your matches, venues and live scores are all in one place.</p>
    </td></tr>

    <!-- CTA -->
    <tr><td class="px" align="center" style="padding:24px 36px 4px;">
      <!--[if mso]>
      <v:roundrect href="{{schedule_link}}" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="50%" fillcolor="#2346D8" stroke="f">
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;letter-spacing:2px;">VIEW THE FULL SCHEDULE &rarr;</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a class="cta cta-a ondark" href="{{schedule_link}}" target="_blank" style="display:inline-block;background:#2346D8;background-image:linear-gradient(135deg,#1A3594,#2F5BF0);color:#ffffff;box-shadow:0 8px 20px rgba(35,70,216,.28);font-family:Montserrat,Arial,sans-serif;font-size:14px;font-weight:900;letter-spacing:2px;text-transform:uppercase;padding:16px 40px;border-radius:999px;white-space:nowrap;"><span class="gm-screen"><span class="gm-diff">View the full schedule &rarr;</span></span></a>
      <!--<![endif]-->
      <p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#8A93AD;font-family:Montserrat,Arial,sans-serif;">You'll be asked to log in - the schedule opens straight after.</p>
    </td></tr>

    <!-- Features + login steps -->
    <tr><td class="px" style="padding:20px 36px 0;font-family:Montserrat,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6FB;border-radius:12px;">
        <tr><td class="pin" style="padding:16px 20px 6px;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#0B1E5B;">On the platform</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-weight:700;color:#0B1E5B;">
            <tr>
              <td class="col" width="33%" style="padding:0 0 10px;white-space:nowrap;">&#128197; Full schedule</td>
              <td class="col" width="30%" style="padding:0 0 10px;white-space:nowrap;">&#9889; Live scores</td>
              <td class="col" width="37%" style="padding:0 0 10px;white-space:nowrap;">&#127942; Results &amp; standings</td>
            </tr>
          </table>
        </td></tr>
        <tr><td class="pin" style="padding:0 20px;"><div style="height:1px;background:#E3E7F2;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
        <tr><td class="pin" style="padding:12px 20px 16px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#0B1E5B;">How to log in</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:22px;color:#4A5372;">
            <tr><td width="20" valign="top" style="font-weight:800;color:#2346D8;">1.</td><td style="padding-bottom:2px;">Log in with this email&nbsp;ID</td></tr>
            <tr><td width="20" valign="top" style="font-weight:800;color:#2346D8;">2.</td><td style="padding-bottom:2px;">Get your credentials from your <strong style="color:#0B1E5B;" class="nw">Sports POC</strong></td></tr>
            <tr><td width="20" valign="top" style="font-weight:800;color:#2346D8;">3.</td><td style="padding-bottom:2px;">Sign in and change your&nbsp;password</td></tr>
            <tr><td width="20" valign="top" style="font-weight:800;color:#2346D8;">4.</td><td>Open the event to see your&nbsp;fixtures</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <!-- Help + sign-off -->
    <tr><td class="px" style="padding:18px 36px 24px;font-family:Montserrat,Arial,sans-serif;font-size:13px;line-height:21px;color:#4A5372;">
      Trouble signing in? Write to <a href="mailto:play@sportagon.in" style="color:#2346D8;font-weight:800;white-space:nowrap;">play@sportagon.in</a>
      <p style="margin:14px 0 0;">See you on the field,<br><strong style="color:#0B1E5B;">{{organiser_name}}&nbsp;×&nbsp;Sportagon</strong></p>
    </td></tr>

    <!-- Footer -->
    <tr><td class="px darkbg ondark-faint" bgcolor="#0B1E5B" style="background:#0B1E5B;background-image:linear-gradient(120deg,#081646 0%,#0B1E5B 55%,#1A3594 100%);padding:16px 36px;font-family:Montserrat,Arial,sans-serif;font-size:11px;line-height:19px;color:#9FB2EE;letter-spacing:0.3px;">
      <span class="ondark" style="color:#ffffff;font-weight:900;letter-spacing:2.5px;"><span class="gm-screen"><span class="gm-diff">SPORTAGON EOS</span></span></span><br>
      <span class="ondark-faint"><span class="gm-screen"><span class="gm-diff">Official event platform for {{event_name}}</span></span></span><br>
      <a class="ondark" href="https://www.sportagon.in" style="color:#ffffff;text-decoration:underline;"><span class="gm-screen"><span class="gm-diff">www.sportagon.in</span></span></a>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>
`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fill the template. URLs (schedule_link) are not HTML-escaped; everything else is. */
export function renderScheduleLiveEmail(vars: ScheduleLiveVars): { html: string; text: string } {
  const rawKeys = new Set(['schedule_link']);
  const html = TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    if (!(k in vars)) throw new Error('schedule-live template: unknown placeholder {{' + k + '}}');
    const v = String((vars as unknown as Record<string, unknown>)[k] ?? '');
    return rawKeys.has(k) ? v : escapeHtml(v);
  });
  const left = html.match(/\{\{\w+\}\}/g);
  if (left) throw new Error('schedule-live template: unfilled ' + Array.from(new Set(left)).join(', '));
  const text = [
    `Hi ${vars.first_name}, the fixtures are live.`,
    '',
    `The full schedule for ${vars.event_name} is out and your account is ready.`,
    `View it here: ${vars.schedule_link}`,
    '',
    'How to log in: use this email ID, get your credentials from your Sports POC, sign in and change your password, then open the event.',
    '',
    'Trouble signing in? play@sportagon.in',
    `- ${vars.organiser_name} x Sportagon`,
  ].join('\n');
  return { html, text };
}
