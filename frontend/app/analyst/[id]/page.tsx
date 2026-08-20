import TicketDetailView from "@/components/TicketDetailView";

export default function AnalystTicketPage({ params }: { params: { id: string } }) {
  return <TicketDetailView ticketId={params.id} isAnalystView />;
}
