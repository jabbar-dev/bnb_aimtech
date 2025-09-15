// config/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendMail({ to, subject, html, text }) {
  return transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    html,
    text: text || html?.replace(/<[^>]+>/g, ' '),
  });
}

module.exports = { transporter, sendMail };
