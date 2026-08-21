import AnalystTicketWorkspace from "@/components/AnalystTicketWorkspace";

export default function AnalystTicketPage({ params }: { params: { id: string } }) {
  return <AnalystTicketWorkspace ticketId={params.id} />;
}
