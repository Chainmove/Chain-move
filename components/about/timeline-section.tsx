"use client";

import { Badge } from "@/components/ui/badge"
import { useEffect, useRef, useState } from "react"

const milestones = [
  {
    year: "2024",
    title: "Company Founded",
    description: "ChainMove was established with a vision to democratize vehicle financing.",
  },
  { year: "2024", title: "MVP Launch", description: "Launched our minimum viable product on Lisk testnet." },
  {
    year: "2025",
    title: "Seed Funding",
    description: "Raised $20,000 in seed funding from AyaHq X LiskHQ Incubation Program.",
  },
  {
    year: "2025",
    title: "Mainnet Launch",
    description: "Successfully deployed on Lisk mainnet with first vehicle fundings.",
  },
  {
    year: "2025",
    title: "Global Expansion",
    description: "Expanding operations to 5 new countries across Africa.",
  },
]

export function TimelineSection() {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [visible, setVisible] = useState<boolean[]>(new Array(milestones.length).fill(false))

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"))
            setVisible(v => {
              const copy = [...v]
              copy[index] = true
              return copy
            })
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.2 }
    )

    itemRefs.current.forEach(el => {
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  return (
    <section className="py-16 bg-background -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-[#142841] dark:text-white mb-4">Our Journey 📅</h2>
        <p className="text-lg text-gray-600 dark:text-gray-300">Key milestones in ChainMove's growth</p>
      </div>
      <div className="max-w-5xl mx-auto relative">
        <div className="absolute inset-y-0 left-1/2 w-0.5 bg-[#E57700] dark:bg-[#FFD580] transform -translate-x-1/2"></div>
        <div className="space-y-12">
          {milestones.map((milestone, index) => {
            const isLeft = index % 2 === 0
            return (
              <div
                key={index}
                data-index={index}
                ref={el => { itemRefs.current[index] = el }}
                className={`relative grid grid-cols-3 gap-4 items-start transition-all duration-700 ease-out transform ${
                  visible[index] ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
              >
                {/* Left column */}
                {isLeft ? (
                  <div className="col-span-1 flex justify-end pr-6 text-right">
                    <div>
                      <Badge className="bg-[#142841] dark:bg-[#FFD580] text-white dark:text-[#142841] mb-2">
                        {milestone.year}
                      </Badge>
                      <h3 className="text-lg font-semibold text-[#142841] dark:text-white mb-1">
                        {milestone.title}
                      </h3>
                      <p className="text-gray-600 dark:text-gray-300 max-w-sm ml-auto">
                        {milestone.description}
                      </p>
                </div>
                  </div>
                ) : (
                  <div className="col-span-1"></div>
                )}

                {/* Center dot */}
                <div className="col-span-1 flex justify-center">
                  <div className="w-5 h-5 bg-[#E57700] dark:bg-[#FFD580] rounded-full mt-1"></div>
                </div>

                {/* Right column */}
                {!isLeft ? (
                  <div className="col-span-1 pl-6">
                    <Badge className="bg-[#142841] dark:bg-[#FFD580] text-white dark:text-[#142841] mb-2">
                      {milestone.year}
                    </Badge>
                    <h3 className="text-lg font-semibold text-[#142841] dark:text-white mb-1">
                      {milestone.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300 max-w-sm">
                      {milestone.description}
                    </p>
                  </div>
                ) : (
                  <div className="col-span-1"></div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
