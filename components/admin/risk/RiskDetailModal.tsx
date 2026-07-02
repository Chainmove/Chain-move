import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface RiskDetailModalProps {
  isOpen: boolean
  onClose: () => void
  record: any | null
}

export function RiskDetailModal({ isOpen, onClose, record }: RiskDetailModalProps) {
  if (!record) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Risk Record Details</DialogTitle>
          <DialogDescription>
            Inspect the details of this flagged record to determine the necessary administrative action.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="rounded-md bg-muted/50 p-4 overflow-x-auto text-xs font-mono border">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(record, null, 2)}
            </pre>
          </div>
          
          <div className="space-y-2">
            <h4 className="font-medium leading-none text-sm">Admin Action</h4>
            <p className="text-sm text-muted-foreground">
              What would you like to do with this flagged record? Actions will be implemented in the next phase.
            </p>
          </div>
        </div>
        
        <DialogFooter className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="destructive" onClick={() => {
            console.log("Suspend entity triggered for:", record._id)
            onClose()
          }}>
            Suspend Entity
          </Button>
          <Button variant="default" onClick={() => {
            console.log("Mark as resolved triggered for:", record._id)
            onClose()
          }}>
            Mark as Resolved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
