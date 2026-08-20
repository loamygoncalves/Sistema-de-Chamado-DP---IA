import TicketDetailView from "@/components/TicketDetailView";

export default function TicketPage({ params }: { params: { id: string } }) {
  return <TicketDetailView ticketId={params.id} />;
}
