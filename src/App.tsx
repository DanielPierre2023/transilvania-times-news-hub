import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import GDPRConsent from "@/components/GDPRConsent";
import Index from "./pages/Index.tsx";
import Article from "./pages/Article.tsx";
import Category from "./pages/Category.tsx";
import SearchResults from "./pages/SearchResults.tsx";
import TermsConditions from "./pages/TermsConditions.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/article/:slug" element={<Article />} />
          <Route path="/category/:name" element={<Category />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/terms" element={<TermsConditions />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        <GDPRConsent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
