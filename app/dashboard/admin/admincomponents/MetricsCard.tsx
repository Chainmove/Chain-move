
// app/dashboard/admin/admincomponents/MetricsCard.tsx

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MetricsCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
}

/**
 * Renders a single metric card with a gradient background.
 * This component is used to display key performance indicators (KPIs) in a visually
 * appealing and consistent format across the dashboard.
 * @param props The props for the component.
 * @returns The rendered metrics card.
 */
const MetricsCard: React.FC<MetricsCardProps> = ({ title, value, description, icon: Icon, gradient }) => (
  <Card className={`text-white border-0 ${gradient}`}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4" />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs opacity-80">{description}</p>
    </CardContent>
  </Card>
);

export default MetricsCard;
