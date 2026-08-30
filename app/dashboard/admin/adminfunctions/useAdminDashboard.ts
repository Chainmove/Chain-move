
// app/dashboard/admin/adminfunctions/useAdminDashboard.ts

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { DashboardStats, Vehicle } from "@/types";
import {
  fetchDashboardStats,
  fetchVehicles,
  addVehicle,
  updateVehicle,
  deleteVehicle,
  uploadImage,
} from "./api";

/**
 * Custom hook to manage the state and logic of the admin dashboard.
 * This hook encapsulates all the business logic, including data fetching,
 * vehicle management, and UI state, keeping the main component clean and focused on rendering.
 * @returns An object containing the dashboard state and handler functions.
 */
export const useAdminDashboard = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    name: "",
    type: "",
    year: "",
    price: "",
    roi: "",
    features: "",
    image: "",
    engine: "",
    fuelType: "Petrol",
    transmission: "Automatic",
    color: "",
    vin: "",
  });
  const { toast } = useToast();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isEditVehicleOpen, setIsEditVehicleOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const statsData = await fetchDashboardStats();
      setStats(statsData);
      setLastUpdated(new Date());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred";
      setError(errorMessage);
      toast({
        title: "Error",
        description: "Failed to fetch dashboard statistics",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadVehicles = useCallback(async () => {
    try {
      setVehiclesLoading(true);
      const vehiclesData = await fetchVehicles();
      setVehicles(vehiclesData);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to fetch vehicles",
        variant: "destructive",
      });
    } finally {
      setVehiclesLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDashboardData();
    loadVehicles();

    const interval = setInterval(() => {
      loadDashboardData();
      loadVehicles();
    }, 30000000);

    return () => clearInterval(interval);
  }, [loadDashboardData, loadVehicles]);

  const handleAddVehicle = async () => {
    try {
      const vehicleData = {
        name: newVehicle.name,
        type: newVehicle.type,
        year: Number.parseInt(newVehicle.year),
        price: Number.parseInt(newVehicle.price),
        // Remove roi field - it will be set by first investor
        features: newVehicle.features.split(",").map((f) => f.trim()),
        image: newVehicle.image || "/placeholder.svg?height=200&width=300",
        status: "Available",
        specifications: {
          engine: newVehicle.engine || "2.0L 4-Cylinder",
          fuelType: newVehicle.fuelType,
          mileage: "0 km",
          transmission: newVehicle.transmission,
          color: newVehicle.color || "White",
          vin: newVehicle.vin || `VIN${Date.now()}`,
        },
        addedDate: new Date().toISOString(),
        popularity: 0,
        isTermSet: false, // New field
      };

      await addVehicle(vehicleData as unknown as Omit<Vehicle, '_id'>);

      toast({
        title: "Vehicle Added",
        description: `${vehicleData.name} has been added. ROI will be set by the first investor.`,
      });

      setNewVehicle({
        name: "",
        type: "",
        year: "",
        price: "",
        roi: "",
        features: "",
        image: "",
        engine: "",
        fuelType: "Petrol",
        transmission: "Automatic",
        color: "",
        vin: "",
      });
      setImagePreview(null);
      setIsAddVehicleOpen(false);

      loadVehicles();
      loadDashboardData();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to add vehicle",
        variant: "destructive",
      });
    }
  };

  const handleEditVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setNewVehicle({
      name: vehicle.name,
      type: vehicle.type,
      year: vehicle.year.toString(),
      price: vehicle.price.toString(),
      roi: vehicle.roi.toString(),
      features: vehicle.features.join(", "),
      image: vehicle.image || "",
      engine: vehicle.specifications.engine,
      fuelType: vehicle.specifications.fuelType,
      transmission: vehicle.specifications.transmission,
      color: vehicle.specifications.color,
      vin: vehicle.specifications.vin,
    });
    setIsEditVehicleOpen(true);
  };

  const handleUpdateVehicle = async () => {
    if (!selectedVehicle) return;

    try {
      const vehicleData = {
        name: newVehicle.name,
        type: newVehicle.type,
        year: Number.parseInt(newVehicle.year),
        price: Number.parseInt(newVehicle.price),
        roi: Number.parseFloat(newVehicle.roi),
        features: newVehicle.features.split(",").map((f) => f.trim()),
        image: newVehicle.image,
        specifications: {
          engine: newVehicle.engine,
          fuelType: newVehicle.fuelType,
          mileage: selectedVehicle.specifications.mileage,
          transmission: newVehicle.transmission,
          color: newVehicle.color,
          vin: newVehicle.vin,
        },
      };

      await updateVehicle(selectedVehicle._id, vehicleData);

      toast({
        title: "Vehicle Updated",
        description: `${vehicleData.name} has been updated successfully`,
      });

      setIsEditVehicleOpen(false);
      setSelectedVehicle(null);
      loadVehicles();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update vehicle",
        variant: "destructive",
      });
    }
  };

  const handleDeleteVehicle = async (vehicleId: string, vehicleName: string) => {
    if (!confirm(`Are you sure you want to delete ${vehicleName}?`)) return;

    try {
      await deleteVehicle(vehicleId);

      toast({
        title: "Vehicle Deleted",
        description: `${vehicleName} has been deleted successfully`,
      });
      loadVehicles();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete vehicle",
        variant: "destructive",
      });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setImageUploading(true);

        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreview(reader.result as string);
        };
        reader.readAsDataURL(file);

        const imageUrl = await uploadImage(file);

        setNewVehicle({ ...newVehicle, image: imageUrl });

        toast({
          title: "Image Uploaded",
          description: "Vehicle image has been uploaded successfully",
        });
      } catch (error) {
        toast({
          title: "Upload Error",
          description: "Failed to upload image. Please try again.",
          variant: "destructive",
        });
        console.error("Upload error:", error);
      } finally {
        setImageUploading(false);
      }
    }
  };

  return {
    stats,
    loading,
    error,
    lastUpdated,
    isAddVehicleOpen,
    setIsAddVehicleOpen,
    newVehicle,
    setNewVehicle,
    vehicles,
    vehiclesLoading,
    selectedVehicle,
    isEditVehicleOpen,
    setIsEditVehicleOpen,
    imagePreview,
    imageUploading,
    loadDashboardData,
    handleAddVehicle,
    handleEditVehicle,
    handleUpdateVehicle,
    handleDeleteVehicle,
    handleImageUpload,
    loadVehicles,
  };
};
