import { landingAssets } from "@/components/landing/assets"
import { Container } from "@/components/landing/Container"
import { Linkedin, Mail, Phone, Twitter } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

const quickLinks = [
  { label: "Home", href: "/investor" },
  { label: "How It Works", href: "/investor#how-it-works" },
  { label: "For Drivers", href: "/driver" },
  { label: "For Investors", href: "/investor" },
  { label: "FAQs", href: "/investor#faqs" },
]

const companyLinks = [
  { label: "About Us", href: "/about" },
  { label: "Terms of Service", href: "#" },
  { label: "Privacy Policy", href: "#" },
]

const socialLinks = [
  {
    label: "Email",
    href: "mailto:okoyeemmanuelobiajulu@gmail.com",
    icon: Mail,
  },
  {
    label: "Phone",
    href: "tel:+2349069406647",
    icon: Phone,
  },
  {
    label: "X",
    href: "https://x.com/chainmove1",
    icon: Twitter,
    external: true,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/chainmove/",
    icon: Linkedin,
    external: true,
  },
] as const

export function Footer() {
  return (
    <footer className="bg-cm-dark py-20 text-cm-text">
      <Container>
        <div className="grid gap-12 border-b border-white/10 pb-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/investor" className="inline-flex items-center gap-3">
              <div className="relative h-9 w-9 overflow-hidden rounded-full border border-white/20 bg-white/10">
                <Image src={landingAssets.logo} alt="ChainMove logo" fill className="object-contain p-1.5" sizes="36px" />
              </div>
              <span className="text-2xl font-semibold leading-none text-cm-text md:text-[30px]">ChainMove</span>
            </Link>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              {socialLinks.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-label={item.label}
                  target={(item as any).external ? "_blank" : undefined}
                  rel={(item as any).external ? "noopener noreferrer" : undefined}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/25 text-white/85 transition-colors hover:border-white/45 hover:text-white"
                >
                  <item.icon className="h-5 w-5" />
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-semibold leading-none text-cm-text md:text-[22px]">Quick Links</h3>
            <ul className="mt-5 space-y-2.5 text-sm text-white/70 md:text-base">
              {quickLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xl font-semibold leading-none text-cm-text md:text-[22px]">Company</h3>
            <ul className="mt-5 space-y-2.5 text-sm text-white/70 md:text-base">
              {companyLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xl font-semibold leading-none text-cm-text md:text-[22px]">Contact Info</h3>
            <div className="mt-5 space-y-2.5 text-sm text-white/70 md:text-base">
              <Link href="mailto:okoyeemmanuelobiajulu@gmail.com" className="block break-all transition-colors hover:text-white">
                okoyeemmanuelobiajulu@gmail.com
              </Link>
              <Link href="tel:+2349069406647" className="block transition-colors hover:text-white">
                +2349069406647
              </Link>
              <Link
                href="https://x.com/chainmove1"
                target="_blank"
                rel="noopener noreferrer"
                className="block transition-colors hover:text-white"
              >
                x.com/chainmove1
              </Link>
              <Link
                href="https://www.linkedin.com/company/chainmove/"
                target="_blank"
                rel="noopener noreferrer"
                className="block transition-colors hover:text-white"
              >
                linkedin.com/company/chainmove
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-9 flex flex-col gap-4 text-sm text-white/45 md:flex-row md:items-center md:justify-between md:text-base">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <p>Copyright 2026 ChainMove</p>
            <Link href="#" className="transition-colors hover:text-white/70">
              Terms of Service
            </Link>
            <Link href="#" className="transition-colors hover:text-white/70">
              Privacy & Cookies policy
            </Link>
          </div>
          <p className="text-white/65">okoyeemmanuelobiajulu@gmail.com</p>
        </div>
      </Container>
    </footer>
  )
}
