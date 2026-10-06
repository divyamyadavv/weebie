import "./globals.css";
import {AuthProvider} from "../components/AuthProvider";
export const metadata={title:"Weebie – Watch Together, Stay Closer",description:"Private watch-party rooms for couples and friends."};
export default function RootLayout({children}){return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>}
