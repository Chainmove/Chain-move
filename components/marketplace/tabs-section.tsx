import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FeaturedVehicles } from "./featured-vehicles";
import { VehicleCategories } from "./vehicle-categories";
import { BrowseAllVehicles } from "./browse-all-vehicles";

export function TabsSection() {
	const [activeTab, setActiveTab] = useState("featured");
	return (
		<Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
			<TabsList className="grid w-full grid-cols-3 bg-muted dark:bg-[#23232A] border-border dark:border-gray-700">
				<TabsTrigger
					value="featured"
					className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white text-foreground dark:text-white"
				>
					Featured Vehicles
				</TabsTrigger>
				<TabsTrigger
					value="categories"
					className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white text-foreground dark:text-white"
				>
					Vehicle Categories
				</TabsTrigger>
				<TabsTrigger
					value="search"
					className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white text-foreground dark:text-white"
				>
					Browse All
				</TabsTrigger>
			</TabsList>

			<TabsContent value="featured">
				<FeaturedVehicles {...({} as any)} />
			</TabsContent>
			<TabsContent value="categories">
				<VehicleCategories {...({} as any)} />
			</TabsContent>
			<TabsContent value="search">
				<BrowseAllVehicles {...({} as any)} />
			</TabsContent>
		</Tabs>
	);
}
