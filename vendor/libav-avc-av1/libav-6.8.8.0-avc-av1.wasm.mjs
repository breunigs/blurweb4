/*!
 * libav.js 
 *
 * This software is compiled from several sources, the licenses for which are
 * included herein.
 *
 * ---
 *
 * ffmpeg:
 *
 *  Copyright (c) 2000-2024 Fabrice Bellard et al
 *
 *                   GNU LESSER GENERAL PUBLIC LICENSE
 *                        Version 2.1, February 1999
 *
 *  Copyright (C) 1991, 1999 Free Software Foundation, Inc.
 *  51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 *  Everyone is permitted to copy and distribute verbatim copies
 *  of this license document, but changing it is not allowed.
 *
 * [This is the first released version of the Lesser GPL.  It also counts
 *  as the successor of the GNU Library Public License, version 2, hence
 *  the version number 2.1.]
 *
 *                             Preamble
 *
 *   The licenses for most software are designed to take away your
 * freedom to share and change it.  By contrast, the GNU General Public
 * Licenses are intended to guarantee your freedom to share and change
 * free software--to make sure the software is free for all its users.
 *
 *   This license, the Lesser General Public License, applies to some
 * specially designated software packages--typically libraries--of the
 * Free Software Foundation and other authors who decide to use it.  You
 * can use it too, but we suggest you first think carefully about whether
 * this license or the ordinary General Public License is the better
 * strategy to use in any particular case, based on the explanations below.
 *
 *   When we speak of free software, we are referring to freedom of use,
 * not price.  Our General Public Licenses are designed to make sure that
 * you have the freedom to distribute copies of free software (and charge
 * for this service if you wish); that you receive source code or can get
 * it if you want it; that you can change the software and use pieces of
 * it in new free programs; and that you are informed that you can do
 * these things.
 *
 *   To protect your rights, we need to make restrictions that forbid
 * distributors to deny you these rights or to ask you to surrender these
 * rights.  These restrictions translate to certain responsibilities for
 * you if you distribute copies of the library or if you modify it.
 *
 *   For example, if you distribute copies of the library, whether gratis
 * or for a fee, you must give the recipients all the rights that we gave
 * you.  You must make sure that they, too, receive or can get the source
 * code.  If you link other code with the library, you must provide
 * complete object files to the recipients, so that they can relink them
 * with the library after making changes to the library and recompiling
 * it.  And you must show them these terms so they know their rights.
 *
 *   We protect your rights with a two-step method: (1) we copyright the
 * library, and (2) we offer you this license, which gives you legal
 * permission to copy, distribute and/or modify the library.
 *
 *   To protect each distributor, we want to make it very clear that
 * there is no warranty for the free library.  Also, if the library is
 * modified by someone else and passed on, the recipients should know
 * that what they have is not the original version, so that the original
 * author's reputation will not be affected by problems that might be
 * introduced by others.
 *
 *   Finally, software patents pose a constant threat to the existence of
 * any free program.  We wish to make sure that a company cannot
 * effectively restrict the users of a free program by obtaining a
 * restrictive license from a patent holder.  Therefore, we insist that
 * any patent license obtained for a version of the library must be
 * consistent with the full freedom of use specified in this license.
 *
 *   Most GNU software, including some libraries, is covered by the
 * ordinary GNU General Public License.  This license, the GNU Lesser
 * General Public License, applies to certain designated libraries, and
 * is quite different from the ordinary General Public License.  We use
 * this license for certain libraries in order to permit linking those
 * libraries into non-free programs.
 *
 *   When a program is linked with a library, whether statically or using
 * a shared library, the combination of the two is legally speaking a
 * combined work, a derivative of the original library.  The ordinary
 * General Public License therefore permits such linking only if the
 * entire combination fits its criteria of freedom.  The Lesser General
 * Public License permits more lax criteria for linking other code with
 * the library.
 *
 *   We call this license the "Lesser" General Public License because it
 * does Less to protect the user's freedom than the ordinary General
 * Public License.  It also provides other free software developers Less
 * of an advantage over competing non-free programs.  These disadvantages
 * are the reason we use the ordinary General Public License for many
 * libraries.  However, the Lesser license provides advantages in certain
 * special circumstances.
 *
 *   For example, on rare occasions, there may be a special need to
 * encourage the widest possible use of a certain library, so that it becomes
 * a de-facto standard.  To achieve this, non-free programs must be
 * allowed to use the library.  A more frequent case is that a free
 * library does the same job as widely used non-free libraries.  In this
 * case, there is little to gain by limiting the free library to free
 * software only, so we use the Lesser General Public License.
 *
 *   In other cases, permission to use a particular library in non-free
 * programs enables a greater number of people to use a large body of
 * free software.  For example, permission to use the GNU C Library in
 * non-free programs enables many more people to use the whole GNU
 * operating system, as well as its variant, the GNU/Linux operating
 * system.
 *
 *   Although the Lesser General Public License is Less protective of the
 * users' freedom, it does ensure that the user of a program that is
 * linked with the Library has the freedom and the wherewithal to run
 * that program using a modified version of the Library.
 *
 *   The precise terms and conditions for copying, distribution and
 * modification follow.  Pay close attention to the difference between a
 * "work based on the library" and a "work that uses the library".  The
 * former contains code derived from the library, whereas the latter must
 * be combined with the library in order to run.
 *
 *                   GNU LESSER GENERAL PUBLIC LICENSE
 *    TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION
 *
 *   0. This License Agreement applies to any software library or other
 * program which contains a notice placed by the copyright holder or
 * other authorized party saying it may be distributed under the terms of
 * this Lesser General Public License (also called "this License").
 * Each licensee is addressed as "you".
 *
 *   A "library" means a collection of software functions and/or data
 * prepared so as to be conveniently linked with application programs
 * (which use some of those functions and data) to form executables.
 *
 *   The "Library", below, refers to any such software library or work
 * which has been distributed under these terms.  A "work based on the
 * Library" means either the Library or any derivative work under
 * copyright law: that is to say, a work containing the Library or a
 * portion of it, either verbatim or with modifications and/or translated
 * straightforwardly into another language.  (Hereinafter, translation is
 * included without limitation in the term "modification".)
 *
 *   "Source code" for a work means the preferred form of the work for
 * making modifications to it.  For a library, complete source code means
 * all the source code for all modules it contains, plus any associated
 * interface definition files, plus the scripts used to control compilation
 * and installation of the library.
 *
 *   Activities other than copying, distribution and modification are not
 * covered by this License; they are outside its scope.  The act of
 * running a program using the Library is not restricted, and output from
 * such a program is covered only if its contents constitute a work based
 * on the Library (independent of the use of the Library in a tool for
 * writing it).  Whether that is true depends on what the Library does
 * and what the program that uses the Library does.
 *
 *   1. You may copy and distribute verbatim copies of the Library's
 * complete source code as you receive it, in any medium, provided that
 * you conspicuously and appropriately publish on each copy an
 * appropriate copyright notice and disclaimer of warranty; keep intact
 * all the notices that refer to this License and to the absence of any
 * warranty; and distribute a copy of this License along with the
 * Library.
 *
 *   You may charge a fee for the physical act of transferring a copy,
 * and you may at your option offer warranty protection in exchange for a
 * fee.
 *
 *   2. You may modify your copy or copies of the Library or any portion
 * of it, thus forming a work based on the Library, and copy and
 * distribute such modifications or work under the terms of Section 1
 * above, provided that you also meet all of these conditions:
 *
 *     a) The modified work must itself be a software library.
 *
 *     b) You must cause the files modified to carry prominent notices
 *     stating that you changed the files and the date of any change.
 *
 *     c) You must cause the whole of the work to be licensed at no
 *     charge to all third parties under the terms of this License.
 *
 *     d) If a facility in the modified Library refers to a function or a
 *     table of data to be supplied by an application program that uses
 *     the facility, other than as an argument passed when the facility
 *     is invoked, then you must make a good faith effort to ensure that,
 *     in the event an application does not supply such function or
 *     table, the facility still operates, and performs whatever part of
 *     its purpose remains meaningful.
 *
 *     (For example, a function in a library to compute square roots has
 *     a purpose that is entirely well-defined independent of the
 *     application.  Therefore, Subsection 2d requires that any
 *     application-supplied function or table used by this function must
 *     be optional: if the application does not supply it, the square
 *     root function must still compute square roots.)
 *
 * These requirements apply to the modified work as a whole.  If
 * identifiable sections of that work are not derived from the Library,
 * and can be reasonably considered independent and separate works in
 * themselves, then this License, and its terms, do not apply to those
 * sections when you distribute them as separate works.  But when you
 * distribute the same sections as part of a whole which is a work based
 * on the Library, the distribution of the whole must be on the terms of
 * this License, whose permissions for other licensees extend to the
 * entire whole, and thus to each and every part regardless of who wrote
 * it.
 *
 * Thus, it is not the intent of this section to claim rights or contest
 * your rights to work written entirely by you; rather, the intent is to
 * exercise the right to control the distribution of derivative or
 * collective works based on the Library.
 *
 * In addition, mere aggregation of another work not based on the Library
 * with the Library (or with a work based on the Library) on a volume of
 * a storage or distribution medium does not bring the other work under
 * the scope of this License.
 *
 *   3. You may opt to apply the terms of the ordinary GNU General Public
 * License instead of this License to a given copy of the Library.  To do
 * this, you must alter all the notices that refer to this License, so
 * that they refer to the ordinary GNU General Public License, version 2,
 * instead of to this License.  (If a newer version than version 2 of the
 * ordinary GNU General Public License has appeared, then you can specify
 * that version instead if you wish.)  Do not make any other change in
 * these notices.
 *
 *   Once this change is made in a given copy, it is irreversible for
 * that copy, so the ordinary GNU General Public License applies to all
 * subsequent copies and derivative works made from that copy.
 *
 *   This option is useful when you wish to copy part of the code of
 * the Library into a program that is not a library.
 *
 *   4. You may copy and distribute the Library (or a portion or
 * derivative of it, under Section 2) in object code or executable form
 * under the terms of Sections 1 and 2 above provided that you accompany
 * it with the complete corresponding machine-readable source code, which
 * must be distributed under the terms of Sections 1 and 2 above on a
 * medium customarily used for software interchange.
 *
 *   If distribution of object code is made by offering access to copy
 * from a designated place, then offering equivalent access to copy the
 * source code from the same place satisfies the requirement to
 * distribute the source code, even though third parties are not
 * compelled to copy the source along with the object code.
 *
 *   5. A program that contains no derivative of any portion of the
 * Library, but is designed to work with the Library by being compiled or
 * linked with it, is called a "work that uses the Library".  Such a
 * work, in isolation, is not a derivative work of the Library, and
 * therefore falls outside the scope of this License.
 *
 *   However, linking a "work that uses the Library" with the Library
 * creates an executable that is a derivative of the Library (because it
 * contains portions of the Library), rather than a "work that uses the
 * library".  The executable is therefore covered by this License.
 * Section 6 states terms for distribution of such executables.
 *
 *   When a "work that uses the Library" uses material from a header file
 * that is part of the Library, the object code for the work may be a
 * derivative work of the Library even though the source code is not.
 * Whether this is true is especially significant if the work can be
 * linked without the Library, or if the work is itself a library.  The
 * threshold for this to be true is not precisely defined by law.
 *
 *   If such an object file uses only numerical parameters, data
 * structure layouts and accessors, and small macros and small inline
 * functions (ten lines or less in length), then the use of the object
 * file is unrestricted, regardless of whether it is legally a derivative
 * work.  (Executables containing this object code plus portions of the
 * Library will still fall under Section 6.)
 *
 *   Otherwise, if the work is a derivative of the Library, you may
 * distribute the object code for the work under the terms of Section 6.
 * Any executables containing that work also fall under Section 6,
 * whether or not they are linked directly with the Library itself.
 *
 *   6. As an exception to the Sections above, you may also combine or
 * link a "work that uses the Library" with the Library to produce a
 * work containing portions of the Library, and distribute that work
 * under terms of your choice, provided that the terms permit
 * modification of the work for the customer's own use and reverse
 * engineering for debugging such modifications.
 *
 *   You must give prominent notice with each copy of the work that the
 * Library is used in it and that the Library and its use are covered by
 * this License.  You must supply a copy of this License.  If the work
 * during execution displays copyright notices, you must include the
 * copyright notice for the Library among them, as well as a reference
 * directing the user to the copy of this License.  Also, you must do one
 * of these things:
 *
 *     a) Accompany the work with the complete corresponding
 *     machine-readable source code for the Library including whatever
 *     changes were used in the work (which must be distributed under
 *     Sections 1 and 2 above); and, if the work is an executable linked
 *     with the Library, with the complete machine-readable "work that
 *     uses the Library", as object code and/or source code, so that the
 *     user can modify the Library and then relink to produce a modified
 *     executable containing the modified Library.  (It is understood
 *     that the user who changes the contents of definitions files in the
 *     Library will not necessarily be able to recompile the application
 *     to use the modified definitions.)
 *
 *     b) Use a suitable shared library mechanism for linking with the
 *     Library.  A suitable mechanism is one that (1) uses at run time a
 *     copy of the library already present on the user's computer system,
 *     rather than copying library functions into the executable, and (2)
 *     will operate properly with a modified version of the library, if
 *     the user installs one, as long as the modified version is
 *     interface-compatible with the version that the work was made with.
 *
 *     c) Accompany the work with a written offer, valid for at
 *     least three years, to give the same user the materials
 *     specified in Subsection 6a, above, for a charge no more
 *     than the cost of performing this distribution.
 *
 *     d) If distribution of the work is made by offering access to copy
 *     from a designated place, offer equivalent access to copy the above
 *     specified materials from the same place.
 *
 *     e) Verify that the user has already received a copy of these
 *     materials or that you have already sent this user a copy.
 *
 *   For an executable, the required form of the "work that uses the
 * Library" must include any data and utility programs needed for
 * reproducing the executable from it.  However, as a special exception,
 * the materials to be distributed need not include anything that is
 * normally distributed (in either source or binary form) with the major
 * components (compiler, kernel, and so on) of the operating system on
 * which the executable runs, unless that component itself accompanies
 * the executable.
 *
 *   It may happen that this requirement contradicts the license
 * restrictions of other proprietary libraries that do not normally
 * accompany the operating system.  Such a contradiction means you cannot
 * use both them and the Library together in an executable that you
 * distribute.
 *
 *   7. You may place library facilities that are a work based on the
 * Library side-by-side in a single library together with other library
 * facilities not covered by this License, and distribute such a combined
 * library, provided that the separate distribution of the work based on
 * the Library and of the other library facilities is otherwise
 * permitted, and provided that you do these two things:
 *
 *     a) Accompany the combined library with a copy of the same work
 *     based on the Library, uncombined with any other library
 *     facilities.  This must be distributed under the terms of the
 *     Sections above.
 *
 *     b) Give prominent notice with the combined library of the fact
 *     that part of it is a work based on the Library, and explaining
 *     where to find the accompanying uncombined form of the same work.
 *
 *   8. You may not copy, modify, sublicense, link with, or distribute
 * the Library except as expressly provided under this License.  Any
 * attempt otherwise to copy, modify, sublicense, link with, or
 * distribute the Library is void, and will automatically terminate your
 * rights under this License.  However, parties who have received copies,
 * or rights, from you under this License will not have their licenses
 * terminated so long as such parties remain in full compliance.
 *
 *   9. You are not required to accept this License, since you have not
 * signed it.  However, nothing else grants you permission to modify or
 * distribute the Library or its derivative works.  These actions are
 * prohibited by law if you do not accept this License.  Therefore, by
 * modifying or distributing the Library (or any work based on the
 * Library), you indicate your acceptance of this License to do so, and
 * all its terms and conditions for copying, distributing or modifying
 * the Library or works based on it.
 *
 *   10. Each time you redistribute the Library (or any work based on the
 * Library), the recipient automatically receives a license from the
 * original licensor to copy, distribute, link with or modify the Library
 * subject to these terms and conditions.  You may not impose any further
 * restrictions on the recipients' exercise of the rights granted herein.
 * You are not responsible for enforcing compliance by third parties with
 * this License.
 *
 *   11. If, as a consequence of a court judgment or allegation of patent
 * infringement or for any other reason (not limited to patent issues),
 * conditions are imposed on you (whether by court order, agreement or
 * otherwise) that contradict the conditions of this License, they do not
 * excuse you from the conditions of this License.  If you cannot
 * distribute so as to satisfy simultaneously your obligations under this
 * License and any other pertinent obligations, then as a consequence you
 * may not distribute the Library at all.  For example, if a patent
 * license would not permit royalty-free redistribution of the Library by
 * all those who receive copies directly or indirectly through you, then
 * the only way you could satisfy both it and this License would be to
 * refrain entirely from distribution of the Library.
 *
 * If any portion of this section is held invalid or unenforceable under any
 * particular circumstance, the balance of the section is intended to apply,
 * and the section as a whole is intended to apply in other circumstances.
 *
 * It is not the purpose of this section to induce you to infringe any
 * patents or other property right claims or to contest validity of any
 * such claims; this section has the sole purpose of protecting the
 * integrity of the free software distribution system which is
 * implemented by public license practices.  Many people have made
 * generous contributions to the wide range of software distributed
 * through that system in reliance on consistent application of that
 * system; it is up to the author/donor to decide if he or she is willing
 * to distribute software through any other system and a licensee cannot
 * impose that choice.
 *
 * This section is intended to make thoroughly clear what is believed to
 * be a consequence of the rest of this License.
 *
 *   12. If the distribution and/or use of the Library is restricted in
 * certain countries either by patents or by copyrighted interfaces, the
 * original copyright holder who places the Library under this License may add
 * an explicit geographical distribution limitation excluding those countries,
 * so that distribution is permitted only in or among countries not thus
 * excluded.  In such case, this License incorporates the limitation as if
 * written in the body of this License.
 *
 *   13. The Free Software Foundation may publish revised and/or new
 * versions of the Lesser General Public License from time to time.
 * Such new versions will be similar in spirit to the present version,
 * but may differ in detail to address new problems or concerns.
 *
 * Each version is given a distinguishing version number.  If the Library
 * specifies a version number of this License which applies to it and
 * "any later version", you have the option of following the terms and
 * conditions either of that version or of any later version published by
 * the Free Software Foundation.  If the Library does not specify a
 * license version number, you may choose any version ever published by
 * the Free Software Foundation.
 *
 *   14. If you wish to incorporate parts of the Library into other free
 * programs whose distribution conditions are incompatible with these,
 * write to the author to ask for permission.  For software which is
 * copyrighted by the Free Software Foundation, write to the Free
 * Software Foundation; we sometimes make exceptions for this.  Our
 * decision will be guided by the two goals of preserving the free status
 * of all derivatives of our free software and of promoting the sharing
 * and reuse of software generally.
 *
 *                             NO WARRANTY
 *
 *   15. BECAUSE THE LIBRARY IS LICENSED FREE OF CHARGE, THERE IS NO
 * WARRANTY FOR THE LIBRARY, TO THE EXTENT PERMITTED BY APPLICABLE LAW.
 * EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT HOLDERS AND/OR
 * OTHER PARTIES PROVIDE THE LIBRARY "AS IS" WITHOUT WARRANTY OF ANY
 * KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE
 * LIBRARY IS WITH YOU.  SHOULD THE LIBRARY PROVE DEFECTIVE, YOU ASSUME
 * THE COST OF ALL NECESSARY SERVICING, REPAIR OR CORRECTION.
 *
 *   16. IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN
 * WRITING WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY
 * AND/OR REDISTRIBUTE THE LIBRARY AS PERMITTED ABOVE, BE LIABLE TO YOU
 * FOR DAMAGES, INCLUDING ANY GENERAL, SPECIAL, INCIDENTAL OR
 * CONSEQUENTIAL DAMAGES ARISING OUT OF THE USE OR INABILITY TO USE THE
 * LIBRARY (INCLUDING BUT NOT LIMITED TO LOSS OF DATA OR DATA BEING
 * RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD PARTIES OR A
 * FAILURE OF THE LIBRARY TO OPERATE WITH ANY OTHER SOFTWARE), EVEN IF
 * SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH
 * DAMAGES.
 *
 *                      END OF TERMS AND CONDITIONS
 *
 *            How to Apply These Terms to Your New Libraries
 *
 *   If you develop a new library, and you want it to be of the greatest
 * possible use to the public, we recommend making it free software that
 * everyone can redistribute and change.  You can do so by permitting
 * redistribution under these terms (or, alternatively, under the terms of the
 * ordinary General Public License).
 *
 *   To apply these terms, attach the following notices to the library.  It is
 * safest to attach them to the start of each source file to most effectively
 * convey the exclusion of warranty; and each file should have at least the
 * "copyright" line and a pointer to where the full notice is found.
 *
 *     <one line to give the library's name and a brief idea of what it does.>
 *     Copyright (C) <year>  <name of author>
 *
 *     This library is free software; you can redistribute it and/or
 *     modify it under the terms of the GNU Lesser General Public
 *     License as published by the Free Software Foundation; either
 *     version 2.1 of the License, or (at your option) any later version.
 *
 *     This library is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 *     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *     Lesser General Public License for more details.
 *
 *     You should have received a copy of the GNU Lesser General Public
 *     License along with this library; if not, write to the Free Software
 *     Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 *
 * Also add information on how to contact you by electronic and paper mail.
 *
 * You should also get your employer (if you work as a programmer) or your
 * school, if any, to sign a "copyright disclaimer" for the library, if
 * necessary.  Here is a sample; alter the names:
 *
 *   Yoyodyne, Inc., hereby disclaims all copyright interest in the
 *   library `Frob' (a library for tweaking knobs) written by James Random Hacker.
 *
 *   <signature of Ty Coon>, 1 April 1990
 *   Ty Coon, President of Vice
 *
 * That's all there is to it!
 *
 *
 * ---
 *
 * libaom:
 *
 * Copyright (c) 2016, Alliance for Open Media. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in
 *    the documentation and/or other materials provided with the
 *    distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 * FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *
 *
 * ---
 *
 * emscripten and musl:
 *
 * Copyright (c) 2010-2024 Emscripten authors, see AUTHORS file.
 * Copyright © 2005-2024 Rich Felker, et al.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 * emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 5.0.7 (263db4cffa6f9fc2ec514a70abac81362ea41849)
 *
 */
async function LibAVFactory(moduleArg={}){var moduleRtn;var Module=moduleArg;var ENVIRONMENT_IS_WEB=!!globalThis.window;var ENVIRONMENT_IS_WORKER=!!globalThis.WorkerGlobalScope;var ENVIRONMENT_IS_NODE=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";if(ENVIRONMENT_IS_NODE){const{createRequire}=await import("node:module");var require=createRequire(import.meta.url)}if(typeof _scriptName==="undefined"){if(typeof LibAV==="object"&&LibAV&&LibAV.base)_scriptName=LibAV.base+"/libav-6.8.8.0-avc-av1.wasm.mjs";else if(typeof self==="object"&&self&&self.location)_scriptName=self.location.href}Module.locateFile=function(path,prefix){if(path.lastIndexOf(".wasm")===path.length-5&&path.indexOf("libav-")!==-1){if(Module.wasmurl)return Module.wasmurl;if(Module.variant)return prefix+"libav-6.8.8.0-"+Module.variant+".wasm.wasm"}return prefix+path};var arguments_=[];var thisProgram="./this.program";var quit_=(status,toThrow)=>{throw toThrow};var _scriptName=import.meta.url;var scriptDirectory="";function locateFile(path){if(Module["locateFile"]){return Module["locateFile"](path,scriptDirectory)}return scriptDirectory+path}var readAsync,readBinary;if(ENVIRONMENT_IS_NODE){var fs=require("node:fs");if(_scriptName.startsWith("file:")){scriptDirectory=require("node:path").dirname(require("node:url").fileURLToPath(_scriptName))+"/"}readBinary=filename=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename);return ret};readAsync=async(filename,binary=true)=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename,binary?undefined:"utf8");return ret};if(process.argv.length>1){thisProgram=process.argv[1].replace(/\\/g,"/")}arguments_=process.argv.slice(2);quit_=(status,toThrow)=>{process.exitCode=status;throw toThrow}}else if(ENVIRONMENT_IS_WEB||ENVIRONMENT_IS_WORKER){try{scriptDirectory=new URL(".",_scriptName).href}catch{}{if(ENVIRONMENT_IS_WORKER){readBinary=url=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,false);xhr.responseType="arraybuffer";xhr.send(null);return new Uint8Array(xhr.response)}}readAsync=async url=>{if(isFileURI(url)){return new Promise((resolve,reject)=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,true);xhr.responseType="arraybuffer";xhr.onload=()=>{if(xhr.status==200||xhr.status==0&&xhr.response){resolve(xhr.response);return}reject(xhr.status)};xhr.onerror=reject;xhr.send(null)})}var response=await fetch(url,{credentials:"same-origin"});if(response.ok){return response.arrayBuffer()}throw new Error(response.status+" : "+response.url)}}}else{}var out=console.log.bind(console);var err=console.error.bind(console);var wasmBinary;var ABORT=false;var EXITSTATUS;var isFileURI=filename=>filename.startsWith("file://");class EmscriptenEH{}class EmscriptenSjLj extends EmscriptenEH{}var readyPromiseResolve,readyPromiseReject;var runtimeInitialized=false;function updateMemoryViews(){var b=wasmMemory.buffer;Module["HEAP8"]=HEAP8=new Int8Array(b);Module["HEAP16"]=HEAP16=new Int16Array(b);Module["HEAPU8"]=HEAPU8=new Uint8Array(b);Module["HEAPU16"]=HEAPU16=new Uint16Array(b);Module["HEAP32"]=HEAP32=new Int32Array(b);Module["HEAPU32"]=HEAPU32=new Uint32Array(b);Module["HEAPF32"]=HEAPF32=new Float32Array(b);HEAPF64=new Float64Array(b)}function preRun(){if(Module["preRun"]){if(typeof Module["preRun"]=="function")Module["preRun"]=[Module["preRun"]];while(Module["preRun"].length){addOnPreRun(Module["preRun"].shift())}}callRuntimeCallbacks(onPreRuns)}function initRuntime(){runtimeInitialized=true;if(!Module["noFSInit"]&&!FS.initialized)FS.init();TTY.init();wasmExports["v"]();FS.ignorePermissions=false}function postRun(){if(Module["postRun"]){if(typeof Module["postRun"]=="function")Module["postRun"]=[Module["postRun"]];while(Module["postRun"].length){addOnPostRun(Module["postRun"].shift())}}callRuntimeCallbacks(onPostRuns)}function abort(what){Module["onAbort"]?.(what);what=`Aborted(${what})`;err(what);ABORT=true;what+=". Build with -sASSERTIONS for more info.";var e=new WebAssembly.RuntimeError(what);readyPromiseReject?.(e);throw e}var wasmBinaryFile;function findWasmBinary(){if(Module["locateFile"]){return locateFile("libav-6.8.8.0-avc-av1.wasm.wasm")}return new URL("libav-6.8.8.0-avc-av1.wasm.wasm",import.meta.url).href}function getBinarySync(file){if(file==wasmBinaryFile&&wasmBinary){return new Uint8Array(wasmBinary)}if(readBinary){return readBinary(file)}throw"both async and sync fetching of the wasm failed"}async function getWasmBinary(binaryFile){if(!wasmBinary){try{var response=await readAsync(binaryFile);return new Uint8Array(response)}catch{}}return getBinarySync(binaryFile)}async function instantiateArrayBuffer(binaryFile,imports){try{var binary=await getWasmBinary(binaryFile);var instance=await WebAssembly.instantiate(binary,imports);return instance}catch(reason){err(`failed to asynchronously prepare wasm: ${reason}`);abort(reason)}}async function instantiateAsync(binary,binaryFile,imports){if(!binary&&!isFileURI(binaryFile)&&!ENVIRONMENT_IS_NODE){try{var response=fetch(binaryFile,{credentials:"same-origin"});var instantiationResult=await WebAssembly.instantiateStreaming(response,imports);return instantiationResult}catch(reason){err(`wasm streaming compile failed: ${reason}`);err("falling back to ArrayBuffer instantiation")}}return instantiateArrayBuffer(binaryFile,imports)}function getWasmImports(){var imports={a:wasmImports};return imports}async function createWasm(){function receiveInstance(instance,module){wasmExports=instance.exports;wasmExports=Asyncify.instrumentWasmExports(wasmExports);assignWasmExports(wasmExports);updateMemoryViews();return wasmExports}function receiveInstantiationResult(result){return receiveInstance(result["instance"])}var info=getWasmImports();if(Module["instantiateWasm"]){return new Promise((resolve,reject)=>{Module["instantiateWasm"](info,(inst,mod)=>{resolve(receiveInstance(inst,mod))})})}wasmBinaryFile??=findWasmBinary();var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);var exports=receiveInstantiationResult(result);return exports}var tempDouble;var tempI64;class ExitStatus{name="ExitStatus";constructor(status){this.message=`Program terminated with exit(${status})`;this.status=status}}var HEAP16;var HEAP32;var HEAP8;var HEAPF32;var HEAPF64;var HEAPU16;var HEAPU32;var HEAPU8;var callRuntimeCallbacks=callbacks=>{while(callbacks.length>0){callbacks.shift()(Module)}};var onPostRuns=[];var addOnPostRun=cb=>onPostRuns.push(cb);var onPreRuns=[];var addOnPreRun=cb=>onPreRuns.push(cb);var dynCalls={};var noExitRuntime=true;var stackRestore=val=>__emscripten_stack_restore(val);var stackSave=()=>_emscripten_stack_get_current();var PATH={isAbs:path=>path.charAt(0)==="/",splitPath:filename=>{var splitPathRe=/^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;return splitPathRe.exec(filename).slice(1)},normalizeArray:(parts,allowAboveRoot)=>{var up=0;for(var i=parts.length-1;i>=0;i--){var last=parts[i];if(last==="."){parts.splice(i,1)}else if(last===".."){parts.splice(i,1);up++}else if(up){parts.splice(i,1);up--}}if(allowAboveRoot){for(;up;up--){parts.unshift("..")}}return parts},normalize:path=>{var isAbsolute=PATH.isAbs(path),trailingSlash=path.slice(-1)==="/";path=PATH.normalizeArray(path.split("/").filter(p=>!!p),!isAbsolute).join("/");if(!path&&!isAbsolute){path="."}if(path&&trailingSlash){path+="/"}return(isAbsolute?"/":"")+path},dirname:path=>{var result=PATH.splitPath(path),root=result[0],dir=result[1];if(!root&&!dir){return"."}if(dir){dir=dir.slice(0,-1)}return root+dir},basename:path=>path&&path.match(/([^\/]+|\/)\/*$/)[1],join:(...paths)=>PATH.normalize(paths.join("/")),join2:(l,r)=>PATH.normalize(l+"/"+r)};var initRandomFill=()=>{if(ENVIRONMENT_IS_NODE){var nodeCrypto=require("node:crypto");return view=>nodeCrypto.randomFillSync(view)}return view=>(crypto.getRandomValues(view),0)};var randomFill=view=>(randomFill=initRandomFill())(view);var PATH_FS={resolve:(...args)=>{var resolvedPath="",resolvedAbsolute=false;for(var i=args.length-1;i>=-1&&!resolvedAbsolute;i--){var path=i>=0?args[i]:FS.cwd();if(typeof path!="string"){throw new TypeError("Arguments to path.resolve must be strings")}else if(!path){return""}resolvedPath=path+"/"+resolvedPath;resolvedAbsolute=PATH.isAbs(path)}resolvedPath=PATH.normalizeArray(resolvedPath.split("/").filter(p=>!!p),!resolvedAbsolute).join("/");return(resolvedAbsolute?"/":"")+resolvedPath||"."},relative:(from,to)=>{from=PATH_FS.resolve(from).slice(1);to=PATH_FS.resolve(to).slice(1);function trim(arr){var start=0;for(;start<arr.length;start++){if(arr[start]!=="")break}var end=arr.length-1;for(;end>=0;end--){if(arr[end]!=="")break}if(start>end)return[];return arr.slice(start,end-start+1)}var fromParts=trim(from.split("/"));var toParts=trim(to.split("/"));var length=Math.min(fromParts.length,toParts.length);var samePartsLength=length;for(var i=0;i<length;i++){if(fromParts[i]!==toParts[i]){samePartsLength=i;break}}var outputParts=[];for(var i=samePartsLength;i<fromParts.length;i++){outputParts.push("..")}outputParts=outputParts.concat(toParts.slice(samePartsLength));return outputParts.join("/")}};var UTF8Decoder=new TextDecoder;var findStringEnd=(heapOrArray,idx,maxBytesToRead,ignoreNul)=>{var maxIdx=idx+maxBytesToRead;if(ignoreNul)return maxIdx;while(heapOrArray[idx]&&!(idx>=maxIdx))++idx;return idx};var UTF8ArrayToString=(heapOrArray,idx=0,maxBytesToRead,ignoreNul)=>{var endPtr=findStringEnd(heapOrArray,idx,maxBytesToRead,ignoreNul);return UTF8Decoder.decode(heapOrArray.buffer?heapOrArray.subarray(idx,endPtr):new Uint8Array(heapOrArray.slice(idx,endPtr)))};var FS_stdin_getChar_buffer=[];var lengthBytesUTF8=str=>{var len=0;for(var i=0;i<str.length;++i){var c=str.charCodeAt(i);if(c<=127){len++}else if(c<=2047){len+=2}else if(c>=55296&&c<=57343){len+=4;++i}else{len+=3}}return len};var stringToUTF8Array=(str,heap,outIdx,maxBytesToWrite)=>{if(!(maxBytesToWrite>0))return 0;var startIdx=outIdx;var endIdx=outIdx+maxBytesToWrite-1;for(var i=0;i<str.length;++i){var u=str.codePointAt(i);if(u<=127){if(outIdx>=endIdx)break;heap[outIdx++]=u}else if(u<=2047){if(outIdx+1>=endIdx)break;heap[outIdx++]=192|u>>6;heap[outIdx++]=128|u&63}else if(u<=65535){if(outIdx+2>=endIdx)break;heap[outIdx++]=224|u>>12;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63}else{if(outIdx+3>=endIdx)break;heap[outIdx++]=240|u>>18;heap[outIdx++]=128|u>>12&63;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63;i++}}heap[outIdx]=0;return outIdx-startIdx};var intArrayFromString=(stringy,dontAddNull,length)=>{var len=length>0?length:lengthBytesUTF8(stringy)+1;var u8array=new Array(len);var numBytesWritten=stringToUTF8Array(stringy,u8array,0,u8array.length);if(dontAddNull)u8array.length=numBytesWritten;return u8array};var FS_stdin_getChar=()=>{if(!FS_stdin_getChar_buffer.length){var result=null;if(ENVIRONMENT_IS_NODE){var BUFSIZE=256;var buf=Buffer.alloc(BUFSIZE);var bytesRead=0;var fd=process.stdin.fd;try{bytesRead=fs.readSync(fd,buf,0,BUFSIZE)}catch(e){if(e.toString().includes("EOF"))bytesRead=0;else throw e}if(bytesRead>0){result=buf.slice(0,bytesRead).toString("utf-8")}}else if(globalThis.window?.prompt){result=window.prompt("Input: ");if(result!==null){result+="\n"}}else{}if(!result){return null}FS_stdin_getChar_buffer=intArrayFromString(result,true)}return FS_stdin_getChar_buffer.shift()};var TTY={ttys:[],init(){},shutdown(){},register(dev,ops){TTY.ttys[dev]={input:[],output:[],ops};FS.registerDevice(dev,TTY.stream_ops)},stream_ops:{open(stream){var tty=TTY.ttys[stream.node.rdev];if(!tty){throw new FS.ErrnoError(43)}stream.tty=tty;stream.seekable=false},close(stream){stream.tty.ops.fsync(stream.tty)},fsync(stream){stream.tty.ops.fsync(stream.tty)},read(stream,buffer,offset,length,pos){if(!stream.tty||!stream.tty.ops.get_char){throw new FS.ErrnoError(60)}var bytesRead=0;for(var i=0;i<length;i++){var result;try{result=stream.tty.ops.get_char(stream.tty)}catch(e){throw new FS.ErrnoError(29)}if(result===undefined&&bytesRead===0){throw new FS.ErrnoError(6)}if(result===null||result===undefined)break;bytesRead++;buffer[offset+i]=result}if(bytesRead){stream.node.atime=Date.now()}return bytesRead},write(stream,buffer,offset,length,pos){if(!stream.tty||!stream.tty.ops.put_char){throw new FS.ErrnoError(60)}try{for(var i=0;i<length;i++){stream.tty.ops.put_char(stream.tty,buffer[offset+i])}}catch(e){throw new FS.ErrnoError(29)}if(length){stream.node.mtime=stream.node.ctime=Date.now()}return i}},default_tty_ops:{get_char(tty){return FS_stdin_getChar()},put_char(tty,val){if(val===null||val===10){out(UTF8ArrayToString(tty.output));tty.output=[]}else{if(val!=0)tty.output.push(val)}},fsync(tty){if(tty.output?.length>0){out(UTF8ArrayToString(tty.output));tty.output=[]}},ioctl_tcgets(tty){return{c_iflag:25856,c_oflag:5,c_cflag:191,c_lflag:35387,c_cc:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}},ioctl_tcsets(tty,optional_actions,data){return 0},ioctl_tiocgwinsz(tty){return[24,80]}},default_tty1_ops:{put_char(tty,val){if(val===null||val===10){err(UTF8ArrayToString(tty.output));tty.output=[]}else{if(val!=0)tty.output.push(val)}},fsync(tty){if(tty.output?.length>0){err(UTF8ArrayToString(tty.output));tty.output=[]}}}};var mmapAlloc=size=>{abort()};var MEMFS={ops_table:null,mount(mount){return MEMFS.createNode(null,"/",16895,0)},createNode(parent,name,mode,dev){if(FS.isBlkdev(mode)||FS.isFIFO(mode)){throw new FS.ErrnoError(63)}MEMFS.ops_table||={dir:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr,lookup:MEMFS.node_ops.lookup,mknod:MEMFS.node_ops.mknod,rename:MEMFS.node_ops.rename,unlink:MEMFS.node_ops.unlink,rmdir:MEMFS.node_ops.rmdir,readdir:MEMFS.node_ops.readdir,symlink:MEMFS.node_ops.symlink},stream:{llseek:MEMFS.stream_ops.llseek}},file:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr},stream:{llseek:MEMFS.stream_ops.llseek,read:MEMFS.stream_ops.read,write:MEMFS.stream_ops.write,mmap:MEMFS.stream_ops.mmap,msync:MEMFS.stream_ops.msync}},link:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr,readlink:MEMFS.node_ops.readlink},stream:{}},chrdev:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr},stream:FS.chrdev_stream_ops}};var node=FS.createNode(parent,name,mode,dev);if(FS.isDir(node.mode)){node.node_ops=MEMFS.ops_table.dir.node;node.stream_ops=MEMFS.ops_table.dir.stream;node.contents={}}else if(FS.isFile(node.mode)){node.node_ops=MEMFS.ops_table.file.node;node.stream_ops=MEMFS.ops_table.file.stream;node.usedBytes=0;node.contents=MEMFS.emptyFileContents??=new Uint8Array(0)}else if(FS.isLink(node.mode)){node.node_ops=MEMFS.ops_table.link.node;node.stream_ops=MEMFS.ops_table.link.stream}else if(FS.isChrdev(node.mode)){node.node_ops=MEMFS.ops_table.chrdev.node;node.stream_ops=MEMFS.ops_table.chrdev.stream}node.atime=node.mtime=node.ctime=Date.now();if(parent){parent.contents[name]=node;parent.atime=parent.mtime=parent.ctime=node.atime}return node},getFileDataAsTypedArray(node){return node.contents.subarray(0,node.usedBytes)},expandFileStorage(node,newCapacity){var prevCapacity=node.contents.length;if(prevCapacity>=newCapacity)return;var CAPACITY_DOUBLING_MAX=1024*1024;newCapacity=Math.max(newCapacity,prevCapacity*(prevCapacity<CAPACITY_DOUBLING_MAX?2:1.125)>>>0);if(prevCapacity)newCapacity=Math.max(newCapacity,256);var oldContents=MEMFS.getFileDataAsTypedArray(node);node.contents=new Uint8Array(newCapacity);node.contents.set(oldContents)},resizeFileStorage(node,newSize){if(node.usedBytes==newSize)return;var oldContents=node.contents;node.contents=new Uint8Array(newSize);node.contents.set(oldContents.subarray(0,Math.min(newSize,node.usedBytes)));node.usedBytes=newSize},node_ops:{getattr(node){var attr={};attr.dev=FS.isChrdev(node.mode)?node.id:1;attr.ino=node.id;attr.mode=node.mode;attr.nlink=1;attr.uid=0;attr.gid=0;attr.rdev=node.rdev;if(FS.isDir(node.mode)){attr.size=4096}else if(FS.isFile(node.mode)){attr.size=node.usedBytes}else if(FS.isLink(node.mode)){attr.size=node.link.length}else{attr.size=0}attr.atime=new Date(node.atime);attr.mtime=new Date(node.mtime);attr.ctime=new Date(node.ctime);attr.blksize=4096;attr.blocks=Math.ceil(attr.size/attr.blksize);return attr},setattr(node,attr){for(const key of["mode","atime","mtime","ctime"]){if(attr[key]!=null){node[key]=attr[key]}}if(attr.size!==undefined){MEMFS.resizeFileStorage(node,attr.size)}},lookup(parent,name){if(!MEMFS.doesNotExistError){MEMFS.doesNotExistError=new FS.ErrnoError(44);MEMFS.doesNotExistError.stack="<generic error, no stack>"}throw MEMFS.doesNotExistError},mknod(parent,name,mode,dev){return MEMFS.createNode(parent,name,mode,dev)},rename(old_node,new_dir,new_name){var new_node;try{new_node=FS.lookupNode(new_dir,new_name)}catch(e){}if(new_node){if(FS.isDir(old_node.mode)){for(var i in new_node.contents){throw new FS.ErrnoError(55)}}FS.hashRemoveNode(new_node)}delete old_node.parent.contents[old_node.name];new_dir.contents[new_name]=old_node;old_node.name=new_name;new_dir.ctime=new_dir.mtime=old_node.parent.ctime=old_node.parent.mtime=Date.now()},unlink(parent,name){delete parent.contents[name];parent.ctime=parent.mtime=Date.now()},rmdir(parent,name){var node=FS.lookupNode(parent,name);for(var i in node.contents){throw new FS.ErrnoError(55)}delete parent.contents[name];parent.ctime=parent.mtime=Date.now()},readdir(node){return[".","..",...Object.keys(node.contents)]},symlink(parent,newname,oldpath){var node=MEMFS.createNode(parent,newname,511|40960,0);node.link=oldpath;return node},readlink(node){if(!FS.isLink(node.mode)){throw new FS.ErrnoError(28)}return node.link}},stream_ops:{read(stream,buffer,offset,length,position){var contents=stream.node.contents;if(position>=stream.node.usedBytes)return 0;var size=Math.min(stream.node.usedBytes-position,length);buffer.set(contents.subarray(position,position+size),offset);return size},write(stream,buffer,offset,length,position,canOwn){if(buffer.buffer===HEAP8.buffer){canOwn=false}if(!length)return 0;var node=stream.node;node.mtime=node.ctime=Date.now();if(canOwn){node.contents=buffer.subarray(offset,offset+length);node.usedBytes=length}else if(node.usedBytes===0&&position===0){node.contents=buffer.slice(offset,offset+length);node.usedBytes=length}else{MEMFS.expandFileStorage(node,position+length);node.contents.set(buffer.subarray(offset,offset+length),position);node.usedBytes=Math.max(node.usedBytes,position+length)}return length},llseek(stream,offset,whence){var position=offset;if(whence===1){position+=stream.position}else if(whence===2){if(FS.isFile(stream.node.mode)){position+=stream.node.usedBytes}}if(position<0){throw new FS.ErrnoError(28)}return position},mmap(stream,length,position,prot,flags){if(!FS.isFile(stream.node.mode)){throw new FS.ErrnoError(43)}var ptr;var allocated;var contents=stream.node.contents;if(!(flags&2)&&contents.buffer===HEAP8.buffer){allocated=false;ptr=contents.byteOffset}else{allocated=true;ptr=mmapAlloc(length);if(!ptr){throw new FS.ErrnoError(48)}if(contents){if(position>0||position+length<contents.length){if(contents.subarray){contents=contents.subarray(position,position+length)}else{contents=Array.prototype.slice.call(contents,position,position+length)}}HEAP8.set(contents,ptr)}}return{ptr,allocated}},msync(stream,buffer,offset,length,mmapFlags){MEMFS.stream_ops.write(stream,buffer,0,length,offset,false);return 0}}};var FS_modeStringToFlags=str=>{if(typeof str!="string")return str;var flagModes={r:0,"r+":2,w:512|64|1,"w+":512|64|2,a:1024|64|1,"a+":1024|64|2};var flags=flagModes[str];if(typeof flags=="undefined"){throw new Error(`Unknown file open mode: ${str}`)}return flags};var FS_fileDataToTypedArray=data=>{if(typeof data=="string"){data=intArrayFromString(data,true)}if(!data.subarray){data=new Uint8Array(data)}return data};var FS_getMode=(canRead,canWrite)=>{var mode=0;if(canRead)mode|=292|73;if(canWrite)mode|=146;return mode};var asyncLoad=async url=>{var arrayBuffer=await readAsync(url);return new Uint8Array(arrayBuffer)};var FS_createDataFile=(...args)=>FS.createDataFile(...args);var getUniqueRunDependency=id=>id;var runDependencies=0;var dependenciesFulfilled=null;var removeRunDependency=id=>{runDependencies--;Module["monitorRunDependencies"]?.(runDependencies);if(runDependencies==0){if(dependenciesFulfilled){var callback=dependenciesFulfilled;dependenciesFulfilled=null;callback()}}};var addRunDependency=id=>{runDependencies++;Module["monitorRunDependencies"]?.(runDependencies)};var preloadPlugins=[];var FS_handledByPreloadPlugin=async(byteArray,fullname)=>{if(typeof Browser!="undefined")Browser.init();for(var plugin of preloadPlugins){if(plugin["canHandle"](fullname)){return plugin["handle"](byteArray,fullname)}}return byteArray};var FS_preloadFile=async(parent,name,url,canRead,canWrite,dontCreateFile,canOwn,preFinish)=>{var fullname=name?PATH_FS.resolve(PATH.join2(parent,name)):parent;var dep=getUniqueRunDependency(`cp ${fullname}`);addRunDependency(dep);try{var byteArray=url;if(typeof url=="string"){byteArray=await asyncLoad(url)}byteArray=await FS_handledByPreloadPlugin(byteArray,fullname);preFinish?.();if(!dontCreateFile){FS_createDataFile(parent,name,byteArray,canRead,canWrite,canOwn)}}finally{removeRunDependency(dep)}};var FS_createPreloadedFile=(parent,name,url,canRead,canWrite,onload,onerror,dontCreateFile,canOwn,preFinish)=>{FS_preloadFile(parent,name,url,canRead,canWrite,dontCreateFile,canOwn,preFinish).then(onload).catch(onerror)};var FS={root:null,mounts:[],devices:{},streams:[],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,filesystems:null,syncFSRequests:0,ErrnoError:class{name="ErrnoError";constructor(errno){this.errno=errno}},FSStream:class{shared={};get object(){return this.node}set object(val){this.node=val}get isRead(){return(this.flags&2097155)!==1}get isWrite(){return(this.flags&2097155)!==0}get isAppend(){return this.flags&1024}get flags(){return this.shared.flags}set flags(val){this.shared.flags=val}get position(){return this.shared.position}set position(val){this.shared.position=val}},FSNode:class{node_ops={};stream_ops={};readMode=292|73;writeMode=146;mounted=null;constructor(parent,name,mode,rdev){if(!parent){parent=this}this.parent=parent;this.mount=parent.mount;this.id=FS.nextInode++;this.name=name;this.mode=mode;this.rdev=rdev;this.atime=this.mtime=this.ctime=Date.now()}get read(){return(this.mode&this.readMode)===this.readMode}set read(val){val?this.mode|=this.readMode:this.mode&=~this.readMode}get write(){return(this.mode&this.writeMode)===this.writeMode}set write(val){val?this.mode|=this.writeMode:this.mode&=~this.writeMode}get isFolder(){return FS.isDir(this.mode)}get isDevice(){return FS.isChrdev(this.mode)}},lookupPath(path,opts={}){if(!path){throw new FS.ErrnoError(44)}opts.follow_mount??=true;if(!PATH.isAbs(path)){path=FS.cwd()+"/"+path}linkloop:for(var nlinks=0;nlinks<40;nlinks++){var parts=path.split("/").filter(p=>!!p);var current=FS.root;var current_path="/";for(var i=0;i<parts.length;i++){var islast=i===parts.length-1;if(islast&&opts.parent){break}if(parts[i]==="."){continue}if(parts[i]===".."){current_path=PATH.dirname(current_path);if(FS.isRoot(current)){path=current_path+"/"+parts.slice(i+1).join("/");nlinks--;continue linkloop}else{current=current.parent}continue}current_path=PATH.join2(current_path,parts[i]);try{current=FS.lookupNode(current,parts[i])}catch(e){if(e?.errno===44&&islast&&opts.noent_okay){return{path:current_path}}throw e}if(FS.isMountpoint(current)&&(!islast||opts.follow_mount)){current=current.mounted.root}if(FS.isLink(current.mode)&&(!islast||opts.follow)){if(!current.node_ops.readlink){throw new FS.ErrnoError(52)}var link=current.node_ops.readlink(current);if(!PATH.isAbs(link)){link=PATH.dirname(current_path)+"/"+link}path=link+"/"+parts.slice(i+1).join("/");continue linkloop}}return{path:current_path,node:current}}throw new FS.ErrnoError(32)},getPath(node){var path;while(true){if(FS.isRoot(node)){var mount=node.mount.mountpoint;if(!path)return mount;return mount[mount.length-1]!=="/"?`${mount}/${path}`:mount+path}path=path?`${node.name}/${path}`:node.name;node=node.parent}},hashName(parentid,name){var hash=0;for(var i=0;i<name.length;i++){hash=(hash<<5)-hash+name.charCodeAt(i)|0}return(parentid+hash>>>0)%FS.nameTable.length},hashAddNode(node){var hash=FS.hashName(node.parent.id,node.name);node.name_next=FS.nameTable[hash];FS.nameTable[hash]=node},hashRemoveNode(node){var hash=FS.hashName(node.parent.id,node.name);if(FS.nameTable[hash]===node){FS.nameTable[hash]=node.name_next}else{var current=FS.nameTable[hash];while(current){if(current.name_next===node){current.name_next=node.name_next;break}current=current.name_next}}},lookupNode(parent,name){var errCode=FS.mayLookup(parent);if(errCode){throw new FS.ErrnoError(errCode)}var hash=FS.hashName(parent.id,name);for(var node=FS.nameTable[hash];node;node=node.name_next){var nodeName=node.name;if(node.parent.id===parent.id&&nodeName===name){return node}}return FS.lookup(parent,name)},createNode(parent,name,mode,rdev){var node=new FS.FSNode(parent,name,mode,rdev);FS.hashAddNode(node);return node},destroyNode(node){FS.hashRemoveNode(node)},isRoot(node){return node===node.parent},isMountpoint(node){return!!node.mounted},isFile(mode){return(mode&61440)===32768},isDir(mode){return(mode&61440)===16384},isLink(mode){return(mode&61440)===40960},isChrdev(mode){return(mode&61440)===8192},isBlkdev(mode){return(mode&61440)===24576},isFIFO(mode){return(mode&61440)===4096},isSocket(mode){return(mode&49152)===49152},flagsToPermissionString(flag){var perms=["r","w","rw"][flag&3];if(flag&512){perms+="w"}return perms},nodePermissions(node,perms){if(FS.ignorePermissions){return 0}if(perms.includes("r")&&!(node.mode&292)){return 2}if(perms.includes("w")&&!(node.mode&146)){return 2}if(perms.includes("x")&&!(node.mode&73)){return 2}return 0},mayLookup(dir){if(!FS.isDir(dir.mode))return 54;var errCode=FS.nodePermissions(dir,"x");if(errCode)return errCode;if(!dir.node_ops.lookup)return 2;return 0},mayCreate(dir,name){if(!FS.isDir(dir.mode)){return 54}try{var node=FS.lookupNode(dir,name);return 20}catch(e){}return FS.nodePermissions(dir,"wx")},mayDelete(dir,name,isdir){var node;try{node=FS.lookupNode(dir,name)}catch(e){return e.errno}var errCode=FS.nodePermissions(dir,"wx");if(errCode){return errCode}if(isdir){if(!FS.isDir(node.mode)){return 54}if(FS.isRoot(node)||FS.getPath(node)===FS.cwd()){return 10}}else if(FS.isDir(node.mode)){return 31}return 0},mayOpen(node,flags){if(!node){return 44}if(FS.isLink(node.mode)){return 32}var mode=FS.flagsToPermissionString(flags);if(FS.isDir(node.mode)){if(mode!=="r"||flags&(512|64)){return 31}}return FS.nodePermissions(node,mode)},checkOpExists(op,err){if(!op){throw new FS.ErrnoError(err)}return op},MAX_OPEN_FDS:4096,nextfd(){for(var fd=0;fd<=FS.MAX_OPEN_FDS;fd++){if(!FS.streams[fd]){return fd}}throw new FS.ErrnoError(33)},getStreamChecked(fd){var stream=FS.getStream(fd);if(!stream){throw new FS.ErrnoError(8)}return stream},getStream:fd=>FS.streams[fd],createStream(stream,fd=-1){stream=Object.assign(new FS.FSStream,stream);if(fd==-1){fd=FS.nextfd()}stream.fd=fd;FS.streams[fd]=stream;return stream},closeStream(fd){FS.streams[fd]=null},dupStream(origStream,fd=-1){var stream=FS.createStream(origStream,fd);stream.stream_ops?.dup?.(stream);return stream},doSetAttr(stream,node,attr){var setattr=stream?.stream_ops.setattr;var arg=setattr?stream:node;setattr??=node.node_ops.setattr;FS.checkOpExists(setattr,63);try{setattr(arg,attr)}catch(e){if(e instanceof RangeError){throw new FS.ErrnoError(22)}throw e}},chrdev_stream_ops:{open(stream){var device=FS.getDevice(stream.node.rdev);stream.stream_ops=device.stream_ops;stream.stream_ops.open?.(stream)},llseek(){throw new FS.ErrnoError(70)}},major:dev=>dev>>8,minor:dev=>dev&255,makedev:(ma,mi)=>ma<<8|mi,registerDevice(dev,ops){FS.devices[dev]={stream_ops:ops}},getDevice:dev=>FS.devices[dev],getMounts(mount){var mounts=[];var check=[mount];while(check.length){var m=check.pop();mounts.push(m);check.push(...m.mounts)}return mounts},syncfs(populate,callback){if(typeof populate=="function"){callback=populate;populate=false}FS.syncFSRequests++;if(FS.syncFSRequests>1){err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`)}var mounts=FS.getMounts(FS.root.mount);var completed=0;function doCallback(errCode){FS.syncFSRequests--;return callback(errCode)}function done(errCode){if(errCode){if(!done.errored){done.errored=true;return doCallback(errCode)}return}if(++completed>=mounts.length){doCallback(null)}}for(var mount of mounts){if(mount.type.syncfs){mount.type.syncfs(mount,populate,done)}else{done(null)}}},mount(type,opts,mountpoint){var root=mountpoint==="/";var pseudo=!mountpoint;var node;if(root&&FS.root){throw new FS.ErrnoError(10)}else if(!root&&!pseudo){var lookup=FS.lookupPath(mountpoint,{follow_mount:false});mountpoint=lookup.path;node=lookup.node;if(FS.isMountpoint(node)){throw new FS.ErrnoError(10)}if(!FS.isDir(node.mode)){throw new FS.ErrnoError(54)}}var mount={type,opts,mountpoint,mounts:[]};var mountRoot=type.mount(mount);mountRoot.mount=mount;mount.root=mountRoot;if(root){FS.root=mountRoot}else if(node){node.mounted=mount;if(node.mount){node.mount.mounts.push(mount)}}return mountRoot},unmount(mountpoint){var lookup=FS.lookupPath(mountpoint,{follow_mount:false});if(!FS.isMountpoint(lookup.node)){throw new FS.ErrnoError(28)}var node=lookup.node;var mount=node.mounted;var mounts=FS.getMounts(mount);for(var[hash,current]of Object.entries(FS.nameTable)){while(current){var next=current.name_next;if(mounts.includes(current.mount)){FS.destroyNode(current)}current=next}}node.mounted=null;var idx=node.mount.mounts.indexOf(mount);node.mount.mounts.splice(idx,1)},lookup(parent,name){return parent.node_ops.lookup(parent,name)},mknod(path,mode,dev){var lookup=FS.lookupPath(path,{parent:true});var parent=lookup.node;var name=PATH.basename(path);if(!name){throw new FS.ErrnoError(28)}if(name==="."||name===".."){throw new FS.ErrnoError(20)}var errCode=FS.mayCreate(parent,name);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.mknod){throw new FS.ErrnoError(63)}return parent.node_ops.mknod(parent,name,mode,dev)},statfs(path){return FS.statfsNode(FS.lookupPath(path,{follow:true}).node)},statfsStream(stream){return FS.statfsNode(stream.node)},statfsNode(node){var rtn={bsize:4096,frsize:4096,blocks:1e6,bfree:5e5,bavail:5e5,files:FS.nextInode,ffree:FS.nextInode-1,fsid:42,flags:2,namelen:255};if(node.node_ops.statfs){Object.assign(rtn,node.node_ops.statfs(node.mount.opts.root))}return rtn},create(path,mode=438){mode&=4095;mode|=32768;return FS.mknod(path,mode,0)},mkdir(path,mode=511){mode&=511|512;mode|=16384;return FS.mknod(path,mode,0)},mkdirTree(path,mode){var dirs=path.split("/");var d="";for(var dir of dirs){if(!dir)continue;if(d||PATH.isAbs(path))d+="/";d+=dir;try{FS.mkdir(d,mode)}catch(e){if(e.errno!=20)throw e}}},mkdev(path,mode,dev){if(typeof dev=="undefined"){dev=mode;mode=438}mode|=8192;return FS.mknod(path,mode,dev)},symlink(oldpath,newpath){if(!PATH_FS.resolve(oldpath)){throw new FS.ErrnoError(44)}var lookup=FS.lookupPath(newpath,{parent:true});var parent=lookup.node;if(!parent){throw new FS.ErrnoError(44)}var newname=PATH.basename(newpath);var errCode=FS.mayCreate(parent,newname);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.symlink){throw new FS.ErrnoError(63)}return parent.node_ops.symlink(parent,newname,oldpath)},rename(old_path,new_path){var old_dirname=PATH.dirname(old_path);var new_dirname=PATH.dirname(new_path);var old_name=PATH.basename(old_path);var new_name=PATH.basename(new_path);var lookup,old_dir,new_dir;lookup=FS.lookupPath(old_path,{parent:true});old_dir=lookup.node;lookup=FS.lookupPath(new_path,{parent:true});new_dir=lookup.node;if(!old_dir||!new_dir)throw new FS.ErrnoError(44);if(old_dir.mount!==new_dir.mount){throw new FS.ErrnoError(75)}var old_node=FS.lookupNode(old_dir,old_name);var relative=PATH_FS.relative(old_path,new_dirname);if(relative.charAt(0)!=="."){throw new FS.ErrnoError(28)}relative=PATH_FS.relative(new_path,old_dirname);if(relative.charAt(0)!=="."){throw new FS.ErrnoError(55)}var new_node;try{new_node=FS.lookupNode(new_dir,new_name)}catch(e){}if(old_node===new_node){return}var isdir=FS.isDir(old_node.mode);var errCode=FS.mayDelete(old_dir,old_name,isdir);if(errCode){throw new FS.ErrnoError(errCode)}errCode=new_node?FS.mayDelete(new_dir,new_name,isdir):FS.mayCreate(new_dir,new_name);if(errCode){throw new FS.ErrnoError(errCode)}if(!old_dir.node_ops.rename){throw new FS.ErrnoError(63)}if(FS.isMountpoint(old_node)||new_node&&FS.isMountpoint(new_node)){throw new FS.ErrnoError(10)}if(new_dir!==old_dir){errCode=FS.nodePermissions(old_dir,"w");if(errCode){throw new FS.ErrnoError(errCode)}}FS.hashRemoveNode(old_node);try{old_dir.node_ops.rename(old_node,new_dir,new_name);old_node.parent=new_dir}catch(e){throw e}finally{FS.hashAddNode(old_node)}},rmdir(path){var lookup=FS.lookupPath(path,{parent:true});var parent=lookup.node;var name=PATH.basename(path);var node=FS.lookupNode(parent,name);var errCode=FS.mayDelete(parent,name,true);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.rmdir){throw new FS.ErrnoError(63)}if(FS.isMountpoint(node)){throw new FS.ErrnoError(10)}parent.node_ops.rmdir(parent,name);FS.destroyNode(node)},readdir(path){var lookup=FS.lookupPath(path,{follow:true});var node=lookup.node;var readdir=FS.checkOpExists(node.node_ops.readdir,54);return readdir(node)},unlink(path){var lookup=FS.lookupPath(path,{parent:true});var parent=lookup.node;if(!parent){throw new FS.ErrnoError(44)}var name=PATH.basename(path);var node=FS.lookupNode(parent,name);var errCode=FS.mayDelete(parent,name,false);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.unlink){throw new FS.ErrnoError(63)}if(FS.isMountpoint(node)){throw new FS.ErrnoError(10)}parent.node_ops.unlink(parent,name);FS.destroyNode(node)},readlink(path){var lookup=FS.lookupPath(path);var link=lookup.node;if(!link){throw new FS.ErrnoError(44)}if(!link.node_ops.readlink){throw new FS.ErrnoError(28)}return link.node_ops.readlink(link)},stat(path,dontFollow){var lookup=FS.lookupPath(path,{follow:!dontFollow});var node=lookup.node;var getattr=FS.checkOpExists(node.node_ops.getattr,63);return getattr(node)},fstat(fd){var stream=FS.getStreamChecked(fd);var node=stream.node;var getattr=stream.stream_ops.getattr;var arg=getattr?stream:node;getattr??=node.node_ops.getattr;FS.checkOpExists(getattr,63);return getattr(arg)},lstat(path){return FS.stat(path,true)},doChmod(stream,node,mode,dontFollow){FS.doSetAttr(stream,node,{mode:mode&4095|node.mode&~4095,ctime:Date.now(),dontFollow})},chmod(path,mode,dontFollow){var node;if(typeof path=="string"){var lookup=FS.lookupPath(path,{follow:!dontFollow});node=lookup.node}else{node=path}FS.doChmod(null,node,mode,dontFollow)},lchmod(path,mode){FS.chmod(path,mode,true)},fchmod(fd,mode){var stream=FS.getStreamChecked(fd);FS.doChmod(stream,stream.node,mode,false)},doChown(stream,node,dontFollow){FS.doSetAttr(stream,node,{timestamp:Date.now(),dontFollow})},chown(path,uid,gid,dontFollow){var node;if(typeof path=="string"){var lookup=FS.lookupPath(path,{follow:!dontFollow});node=lookup.node}else{node=path}FS.doChown(null,node,dontFollow)},lchown(path,uid,gid){FS.chown(path,uid,gid,true)},fchown(fd,uid,gid){var stream=FS.getStreamChecked(fd);FS.doChown(stream,stream.node,false)},doTruncate(stream,node,len){if(FS.isDir(node.mode)){throw new FS.ErrnoError(31)}if(!FS.isFile(node.mode)){throw new FS.ErrnoError(28)}var errCode=FS.nodePermissions(node,"w");if(errCode){throw new FS.ErrnoError(errCode)}FS.doSetAttr(stream,node,{size:len,timestamp:Date.now()})},truncate(path,len){if(len<0){throw new FS.ErrnoError(28)}var node;if(typeof path=="string"){var lookup=FS.lookupPath(path,{follow:true});node=lookup.node}else{node=path}FS.doTruncate(null,node,len)},ftruncate(fd,len){var stream=FS.getStreamChecked(fd);if(len<0||(stream.flags&2097155)===0){throw new FS.ErrnoError(28)}FS.doTruncate(stream,stream.node,len)},utime(path,atime,mtime){var lookup=FS.lookupPath(path,{follow:true});var node=lookup.node;var setattr=FS.checkOpExists(node.node_ops.setattr,63);setattr(node,{atime,mtime})},open(path,flags,mode=438){if(path===""){throw new FS.ErrnoError(44)}flags=FS_modeStringToFlags(flags);if(flags&64){mode=mode&4095|32768}else{mode=0}var node;var isDirPath;if(typeof path=="object"){node=path}else{isDirPath=path.endsWith("/");var lookup=FS.lookupPath(path,{follow:!(flags&131072),noent_okay:true});node=lookup.node;path=lookup.path}var created=false;if(flags&64){if(node){if(flags&128){throw new FS.ErrnoError(20)}}else if(isDirPath){throw new FS.ErrnoError(31)}else{node=FS.mknod(path,mode|511,0);created=true}}if(!node){throw new FS.ErrnoError(44)}if(FS.isChrdev(node.mode)){flags&=~512}if(flags&65536&&!FS.isDir(node.mode)){throw new FS.ErrnoError(54)}if(!created){var errCode=FS.mayOpen(node,flags);if(errCode){throw new FS.ErrnoError(errCode)}}if(flags&512&&!created){FS.truncate(node,0)}flags&=~(128|512|131072);var stream=FS.createStream({node,path:FS.getPath(node),flags,seekable:true,position:0,stream_ops:node.stream_ops,ungotten:[],error:false});if(stream.stream_ops.open){stream.stream_ops.open(stream)}if(created){FS.chmod(node,mode&511)}return stream},close(stream){if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if(stream.getdents)stream.getdents=null;try{if(stream.stream_ops.close){stream.stream_ops.close(stream)}}catch(e){throw e}finally{FS.closeStream(stream.fd)}stream.fd=null},isClosed(stream){return stream.fd===null},llseek(stream,offset,whence){if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if(!stream.seekable||!stream.stream_ops.llseek){throw new FS.ErrnoError(70)}if(whence!=0&&whence!=1&&whence!=2){throw new FS.ErrnoError(28)}stream.position=stream.stream_ops.llseek(stream,offset,whence);stream.ungotten=[];return stream.position},read(stream,buffer,offset,length,position){if(length<0||position<0){throw new FS.ErrnoError(28)}if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if((stream.flags&2097155)===1){throw new FS.ErrnoError(8)}if(FS.isDir(stream.node.mode)){throw new FS.ErrnoError(31)}if(!stream.stream_ops.read){throw new FS.ErrnoError(28)}var seeking=typeof position!="undefined";if(!seeking){position=stream.position}else if(!stream.seekable){throw new FS.ErrnoError(70)}var bytesRead=stream.stream_ops.read(stream,buffer,offset,length,position);if(!seeking)stream.position+=bytesRead;return bytesRead},write(stream,buffer,offset,length,position,canOwn){if(length<0||position<0){throw new FS.ErrnoError(28)}if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if((stream.flags&2097155)===0){throw new FS.ErrnoError(8)}if(FS.isDir(stream.node.mode)){throw new FS.ErrnoError(31)}if(!stream.stream_ops.write){throw new FS.ErrnoError(28)}if(stream.seekable&&stream.flags&1024){FS.llseek(stream,0,2)}var seeking=typeof position!="undefined";if(!seeking){position=stream.position}else if(!stream.seekable){throw new FS.ErrnoError(70)}var bytesWritten=stream.stream_ops.write(stream,buffer,offset,length,position,canOwn);if(!seeking)stream.position+=bytesWritten;return bytesWritten},mmap(stream,length,position,prot,flags){if((prot&2)!==0&&(flags&2)===0&&(stream.flags&2097155)!==2){throw new FS.ErrnoError(2)}if((stream.flags&2097155)===1){throw new FS.ErrnoError(2)}if(!stream.stream_ops.mmap){throw new FS.ErrnoError(43)}if(!length){throw new FS.ErrnoError(28)}return stream.stream_ops.mmap(stream,length,position,prot,flags)},msync(stream,buffer,offset,length,mmapFlags){if(!stream.stream_ops.msync){return 0}return stream.stream_ops.msync(stream,buffer,offset,length,mmapFlags)},ioctl(stream,cmd,arg){if(!stream.stream_ops.ioctl){throw new FS.ErrnoError(59)}return stream.stream_ops.ioctl(stream,cmd,arg)},readFile(path,opts={}){opts.flags=opts.flags||0;opts.encoding=opts.encoding||"binary";if(opts.encoding!=="utf8"&&opts.encoding!=="binary"){abort(`Invalid encoding type "${opts.encoding}"`)}var stream=FS.open(path,opts.flags);var stat=FS.stat(path);var length=stat.size;var buf=new Uint8Array(length);FS.read(stream,buf,0,length,0);if(opts.encoding==="utf8"){buf=UTF8ArrayToString(buf)}FS.close(stream);return buf},writeFile(path,data,opts={}){opts.flags=opts.flags||577;var stream=FS.open(path,opts.flags,opts.mode);data=FS_fileDataToTypedArray(data);FS.write(stream,data,0,data.byteLength,undefined,opts.canOwn);FS.close(stream)},cwd:()=>FS.currentPath,chdir(path){var lookup=FS.lookupPath(path,{follow:true});if(lookup.node===null){throw new FS.ErrnoError(44)}if(!FS.isDir(lookup.node.mode)){throw new FS.ErrnoError(54)}var errCode=FS.nodePermissions(lookup.node,"x");if(errCode){throw new FS.ErrnoError(errCode)}FS.currentPath=lookup.path},createDefaultDirectories(){FS.mkdir("/tmp");FS.mkdir("/home");FS.mkdir("/home/web_user")},createDefaultDevices(){FS.mkdir("/dev");FS.registerDevice(FS.makedev(1,3),{read:()=>0,write:(stream,buffer,offset,length,pos)=>length,llseek:()=>0});FS.mkdev("/dev/null",FS.makedev(1,3));TTY.register(FS.makedev(5,0),TTY.default_tty_ops);TTY.register(FS.makedev(6,0),TTY.default_tty1_ops);FS.mkdev("/dev/tty",FS.makedev(5,0));FS.mkdev("/dev/tty1",FS.makedev(6,0));var randomBuffer=new Uint8Array(1024),randomLeft=0;var randomByte=()=>{if(randomLeft===0){randomFill(randomBuffer);randomLeft=randomBuffer.byteLength}return randomBuffer[--randomLeft]};FS.createDevice("/dev","random",randomByte);FS.createDevice("/dev","urandom",randomByte);FS.mkdir("/dev/shm");FS.mkdir("/dev/shm/tmp")},createSpecialDirectories(){FS.mkdir("/proc");var proc_self=FS.mkdir("/proc/self");FS.mkdir("/proc/self/fd");FS.mount({mount(){var node=FS.createNode(proc_self,"fd",16895,73);node.stream_ops={llseek:MEMFS.stream_ops.llseek};node.node_ops={lookup(parent,name){var fd=+name;var stream=FS.getStreamChecked(fd);var ret={parent:null,mount:{mountpoint:"fake"},node_ops:{readlink:()=>stream.path},id:fd+1};ret.parent=ret;return ret},readdir(){return Array.from(FS.streams.entries()).filter(([k,v])=>v).map(([k,v])=>k.toString())}};return node}},{},"/proc/self/fd")},createStandardStreams(input,output,error){if(input){FS.createDevice("/dev","stdin",input)}else{FS.symlink("/dev/tty","/dev/stdin")}if(output){FS.createDevice("/dev","stdout",null,output)}else{FS.symlink("/dev/tty","/dev/stdout")}if(error){FS.createDevice("/dev","stderr",null,error)}else{FS.symlink("/dev/tty1","/dev/stderr")}var stdin=FS.open("/dev/stdin",0);var stdout=FS.open("/dev/stdout",1);var stderr=FS.open("/dev/stderr",1)},staticInit(){FS.nameTable=new Array(4096);FS.mount(MEMFS,{},"/");FS.createDefaultDirectories();FS.createDefaultDevices();FS.createSpecialDirectories();FS.filesystems={MEMFS}},init(input,output,error){FS.initialized=true;input??=Module["stdin"];output??=Module["stdout"];error??=Module["stderr"];FS.createStandardStreams(input,output,error)},quit(){FS.initialized=false;for(var stream of FS.streams){if(stream){FS.close(stream)}}},findObject(path,dontResolveLastLink){var ret=FS.analyzePath(path,dontResolveLastLink);if(!ret.exists){return null}return ret.object},analyzePath(path,dontResolveLastLink){try{var lookup=FS.lookupPath(path,{follow:!dontResolveLastLink});path=lookup.path}catch(e){}var ret={isRoot:false,exists:false,error:0,name:null,path:null,object:null,parentExists:false,parentPath:null,parentObject:null};try{var lookup=FS.lookupPath(path,{parent:true});ret.parentExists=true;ret.parentPath=lookup.path;ret.parentObject=lookup.node;ret.name=PATH.basename(path);lookup=FS.lookupPath(path,{follow:!dontResolveLastLink});ret.exists=true;ret.path=lookup.path;ret.object=lookup.node;ret.name=lookup.node.name;ret.isRoot=lookup.path==="/"}catch(e){ret.error=e.errno}return ret},createPath(parent,path,canRead,canWrite){parent=typeof parent=="string"?parent:FS.getPath(parent);var parts=path.split("/").reverse();while(parts.length){var part=parts.pop();if(!part)continue;var current=PATH.join2(parent,part);try{FS.mkdir(current)}catch(e){if(e.errno!=20)throw e}parent=current}return current},createFile(parent,name,properties,canRead,canWrite){var path=PATH.join2(typeof parent=="string"?parent:FS.getPath(parent),name);var mode=FS_getMode(canRead,canWrite);return FS.create(path,mode)},createDataFile(parent,name,data,canRead,canWrite,canOwn){var path=name;if(parent){parent=typeof parent=="string"?parent:FS.getPath(parent);path=name?PATH.join2(parent,name):parent}var mode=FS_getMode(canRead,canWrite);var node=FS.create(path,mode);if(data){data=FS_fileDataToTypedArray(data);FS.chmod(node,mode|146);var stream=FS.open(node,577);FS.write(stream,data,0,data.length,0,canOwn);FS.close(stream);FS.chmod(node,mode)}},createDevice(parent,name,input,output){var path=PATH.join2(typeof parent=="string"?parent:FS.getPath(parent),name);var mode=FS_getMode(!!input,!!output);FS.createDevice.major??=64;var dev=FS.makedev(FS.createDevice.major++,0);FS.registerDevice(dev,{open(stream){stream.seekable=false},close(stream){if(output?.buffer?.length){output(10)}},read(stream,buffer,offset,length,pos){var bytesRead=0;for(var i=0;i<length;i++){var result;try{result=input()}catch(e){throw new FS.ErrnoError(29)}if(result===undefined&&bytesRead===0){throw new FS.ErrnoError(6)}if(result===null||result===undefined)break;bytesRead++;buffer[offset+i]=result}if(bytesRead){stream.node.atime=Date.now()}return bytesRead},write(stream,buffer,offset,length,pos){for(var i=0;i<length;i++){try{output(buffer[offset+i])}catch(e){throw new FS.ErrnoError(29)}}if(length){stream.node.mtime=stream.node.ctime=Date.now()}return i}});return FS.mkdev(path,mode,dev)},forceLoadFile(obj){if(obj.isDevice||obj.isFolder||obj.link||obj.contents)return true;if(globalThis.XMLHttpRequest){abort("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.")}else{try{obj.contents=readBinary(obj.url)}catch(e){throw new FS.ErrnoError(29)}}},createLazyFile(parent,name,url,canRead,canWrite){class LazyUint8Array{lengthKnown=false;chunks=[];get(idx){if(idx>this.length-1||idx<0){return undefined}var chunkOffset=idx%this.chunkSize;var chunkNum=idx/this.chunkSize|0;return this.getter(chunkNum)[chunkOffset]}setDataGetter(getter){this.getter=getter}cacheLength(){var xhr=new XMLHttpRequest;xhr.open("HEAD",url,false);xhr.send(null);if(!(xhr.status>=200&&xhr.status<300||xhr.status===304))abort("Couldn't load "+url+". Status: "+xhr.status);var datalength=Number(xhr.getResponseHeader("Content-length"));var header;var hasByteServing=(header=xhr.getResponseHeader("Accept-Ranges"))&&header==="bytes";var usesGzip=(header=xhr.getResponseHeader("Content-Encoding"))&&header==="gzip";var chunkSize=1024*1024;if(!hasByteServing)chunkSize=datalength;var doXHR=(from,to)=>{if(from>to)abort("invalid range ("+from+", "+to+") or no bytes requested!");if(to>datalength-1)abort("only "+datalength+" bytes available! programmer error!");var xhr=new XMLHttpRequest;xhr.open("GET",url,false);if(datalength!==chunkSize)xhr.setRequestHeader("Range","bytes="+from+"-"+to);xhr.responseType="arraybuffer";if(xhr.overrideMimeType){xhr.overrideMimeType("text/plain; charset=x-user-defined")}xhr.send(null);if(!(xhr.status>=200&&xhr.status<300||xhr.status===304))abort("Couldn't load "+url+". Status: "+xhr.status);if(xhr.response!==undefined){return new Uint8Array(xhr.response||[])}return intArrayFromString(xhr.responseText||"",true)};var lazyArray=this;lazyArray.setDataGetter(chunkNum=>{var start=chunkNum*chunkSize;var end=(chunkNum+1)*chunkSize-1;end=Math.min(end,datalength-1);if(typeof lazyArray.chunks[chunkNum]=="undefined"){lazyArray.chunks[chunkNum]=doXHR(start,end)}if(typeof lazyArray.chunks[chunkNum]=="undefined")abort("doXHR failed!");return lazyArray.chunks[chunkNum]});if(usesGzip||!datalength){chunkSize=datalength=1;datalength=this.getter(0).length;chunkSize=datalength;out("LazyFiles on gzip forces download of the whole file when length is accessed")}this._length=datalength;this._chunkSize=chunkSize;this.lengthKnown=true}get length(){if(!this.lengthKnown){this.cacheLength()}return this._length}get chunkSize(){if(!this.lengthKnown){this.cacheLength()}return this._chunkSize}}if(globalThis.XMLHttpRequest){if(!ENVIRONMENT_IS_WORKER)abort("Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc");var lazyArray=new LazyUint8Array;var properties={isDevice:false,contents:lazyArray}}else{var properties={isDevice:false,url}}var node=FS.createFile(parent,name,properties,canRead,canWrite);if(properties.contents){node.contents=properties.contents}else if(properties.url){node.contents=null;node.url=properties.url}Object.defineProperties(node,{usedBytes:{get:function(){return this.contents.length}}});var stream_ops={};for(const[key,fn]of Object.entries(node.stream_ops)){stream_ops[key]=(...args)=>{FS.forceLoadFile(node);return fn(...args)}}function writeChunks(stream,buffer,offset,length,position){var contents=stream.node.contents;if(position>=contents.length)return 0;var size=Math.min(contents.length-position,length);if(contents.slice){for(var i=0;i<size;i++){buffer[offset+i]=contents[position+i]}}else{for(var i=0;i<size;i++){buffer[offset+i]=contents.get(position+i)}}return size}stream_ops.read=(stream,buffer,offset,length,position)=>{FS.forceLoadFile(node);return writeChunks(stream,buffer,offset,length,position)};stream_ops.mmap=(stream,length,position,prot,flags)=>{FS.forceLoadFile(node);var ptr=mmapAlloc(length);if(!ptr){throw new FS.ErrnoError(48)}writeChunks(stream,HEAP8,ptr,length,position);return{ptr,allocated:true}};node.stream_ops=stream_ops;return node}};var UTF8ToString=(ptr,maxBytesToRead,ignoreNul)=>{if(!ptr)return"";var end=findStringEnd(HEAPU8,ptr,maxBytesToRead,ignoreNul);return UTF8Decoder.decode(HEAPU8.subarray(ptr,end))};var SYSCALLS={currentUmask:18,calculateAt(dirfd,path,allowEmpty){if(PATH.isAbs(path)){return path}var dir;if(dirfd===-100){dir=FS.cwd()}else{var dirstream=SYSCALLS.getStreamFromFD(dirfd);dir=dirstream.path}if(path.length==0){if(!allowEmpty){throw new FS.ErrnoError(44)}return dir}return dir+"/"+path},writeStat(buf,stat){HEAPU32[buf>>2]=stat.dev;HEAPU32[buf+4>>2]=stat.mode;HEAPU32[buf+8>>2]=stat.nlink;HEAPU32[buf+12>>2]=stat.uid;HEAPU32[buf+16>>2]=stat.gid;HEAPU32[buf+20>>2]=stat.rdev;tempI64=[stat.size>>>0,(tempDouble=stat.size,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+24>>2]=tempI64[0],HEAP32[buf+28>>2]=tempI64[1];HEAP32[buf+32>>2]=4096;HEAP32[buf+36>>2]=stat.blocks;var atime=stat.atime.getTime();var mtime=stat.mtime.getTime();var ctime=stat.ctime.getTime();tempI64=[Math.floor(atime/1e3)>>>0,(tempDouble=Math.floor(atime/1e3),+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+40>>2]=tempI64[0],HEAP32[buf+44>>2]=tempI64[1];HEAPU32[buf+48>>2]=atime%1e3*1e3*1e3;tempI64=[Math.floor(mtime/1e3)>>>0,(tempDouble=Math.floor(mtime/1e3),+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+56>>2]=tempI64[0],HEAP32[buf+60>>2]=tempI64[1];HEAPU32[buf+64>>2]=mtime%1e3*1e3*1e3;tempI64=[Math.floor(ctime/1e3)>>>0,(tempDouble=Math.floor(ctime/1e3),+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+72>>2]=tempI64[0],HEAP32[buf+76>>2]=tempI64[1];HEAPU32[buf+80>>2]=ctime%1e3*1e3*1e3;tempI64=[stat.ino>>>0,(tempDouble=stat.ino,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+88>>2]=tempI64[0],HEAP32[buf+92>>2]=tempI64[1];return 0},writeStatFs(buf,stats){HEAPU32[buf+4>>2]=stats.bsize;HEAPU32[buf+60>>2]=stats.bsize;tempI64=[stats.blocks>>>0,(tempDouble=stats.blocks,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+8>>2]=tempI64[0],HEAP32[buf+12>>2]=tempI64[1];tempI64=[stats.bfree>>>0,(tempDouble=stats.bfree,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+16>>2]=tempI64[0],HEAP32[buf+20>>2]=tempI64[1];tempI64=[stats.bavail>>>0,(tempDouble=stats.bavail,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+24>>2]=tempI64[0],HEAP32[buf+28>>2]=tempI64[1];tempI64=[stats.files>>>0,(tempDouble=stats.files,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+32>>2]=tempI64[0],HEAP32[buf+36>>2]=tempI64[1];tempI64=[stats.ffree>>>0,(tempDouble=stats.ffree,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[buf+40>>2]=tempI64[0],HEAP32[buf+44>>2]=tempI64[1];HEAPU32[buf+48>>2]=stats.fsid;HEAPU32[buf+64>>2]=stats.flags;HEAPU32[buf+56>>2]=stats.namelen},doMsync(addr,stream,len,flags,offset){if(!FS.isFile(stream.node.mode)){throw new FS.ErrnoError(43)}if(flags&2){return 0}var buffer=HEAPU8.slice(addr,addr+len);FS.msync(stream,buffer,offset,len,flags)},getStreamFromFD(fd){var stream=FS.getStreamChecked(fd);return stream},varargs:undefined,getStr(ptr){var ret=UTF8ToString(ptr);return ret}};function ___syscall_dup3(fd,newfd,flags){try{if(fd===newfd)return-28;if(flags&~524288)return-28;var old=SYSCALLS.getStreamFromFD(fd);if(newfd<0||newfd>=FS.MAX_OPEN_FDS)return-8;var existing=FS.getStream(newfd);if(existing)FS.close(existing);var stream=FS.dupStream(old,newfd);if(flags&524288){stream.flags|=524288}return stream.fd}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}var syscallGetVarargI=()=>{var ret=HEAP32[+SYSCALLS.varargs>>2];SYSCALLS.varargs+=4;return ret};var syscallGetVarargP=syscallGetVarargI;function ___syscall_fcntl64(fd,cmd,varargs){SYSCALLS.varargs=varargs;try{var stream=SYSCALLS.getStreamFromFD(fd);switch(cmd){case 0:{var arg=syscallGetVarargI();if(arg<0){return-28}while(FS.streams[arg]){arg++}var newStream;newStream=FS.dupStream(stream,arg);return newStream.fd}case 1:case 2:return 0;case 3:return stream.flags;case 4:{var arg=syscallGetVarargI();var mask=289792;stream.flags=stream.flags&~mask|arg&mask;return 0}case 12:{var arg=syscallGetVarargP();var offset=0;HEAP16[arg+offset>>1]=2;return 0}case 13:case 14:return 0}return-28}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_ioctl(fd,op,varargs){SYSCALLS.varargs=varargs;try{var stream=SYSCALLS.getStreamFromFD(fd);switch(op){case 21509:{if(!stream.tty)return-59;return 0}case 21505:{if(!stream.tty)return-59;if(stream.tty.ops.ioctl_tcgets){var termios=stream.tty.ops.ioctl_tcgets(stream);var argp=syscallGetVarargP();HEAP32[argp>>2]=termios.c_iflag||0;HEAP32[argp+4>>2]=termios.c_oflag||0;HEAP32[argp+8>>2]=termios.c_cflag||0;HEAP32[argp+12>>2]=termios.c_lflag||0;for(var i=0;i<32;i++){HEAP8[argp+i+17]=termios.c_cc[i]||0}return 0}return 0}case 21510:case 21511:case 21512:{if(!stream.tty)return-59;return 0}case 21506:case 21507:case 21508:{if(!stream.tty)return-59;if(stream.tty.ops.ioctl_tcsets){var argp=syscallGetVarargP();var c_iflag=HEAP32[argp>>2];var c_oflag=HEAP32[argp+4>>2];var c_cflag=HEAP32[argp+8>>2];var c_lflag=HEAP32[argp+12>>2];var c_cc=[];for(var i=0;i<32;i++){c_cc.push(HEAP8[argp+i+17])}return stream.tty.ops.ioctl_tcsets(stream.tty,op,{c_iflag,c_oflag,c_cflag,c_lflag,c_cc})}return 0}case 21519:{if(!stream.tty)return-59;var argp=syscallGetVarargP();HEAP32[argp>>2]=0;return 0}case 21520:{if(!stream.tty)return-59;return-28}case 21537:case 21531:{var argp=syscallGetVarargP();return FS.ioctl(stream,op,argp)}case 21523:{if(!stream.tty)return-59;if(stream.tty.ops.ioctl_tiocgwinsz){var winsize=stream.tty.ops.ioctl_tiocgwinsz(stream.tty);var argp=syscallGetVarargP();HEAP16[argp>>1]=winsize[0];HEAP16[argp+2>>1]=winsize[1]}return 0}case 21524:{if(!stream.tty)return-59;return 0}case 21515:{if(!stream.tty)return-59;return 0}default:return-28}}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_openat(dirfd,path,flags,varargs){SYSCALLS.varargs=varargs;try{path=SYSCALLS.getStr(path);path=SYSCALLS.calculateAt(dirfd,path);var mode=varargs?syscallGetVarargI():0;if(flags&64){mode&=~SYSCALLS.currentUmask}return FS.open(path,flags,mode).fd}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}var __abort_js=()=>abort("");var convertI32PairToI53Checked=(lo,hi)=>hi+2097152>>>0<4194305-!!lo?(lo>>>0)+hi*4294967296:NaN;var isLeapYear=year=>year%4===0&&(year%100!==0||year%400===0);var MONTH_DAYS_LEAP_CUMULATIVE=[0,31,60,91,121,152,182,213,244,274,305,335];var MONTH_DAYS_REGULAR_CUMULATIVE=[0,31,59,90,120,151,181,212,243,273,304,334];var ydayFromDate=date=>{var leap=isLeapYear(date.getFullYear());var monthDaysCumulative=leap?MONTH_DAYS_LEAP_CUMULATIVE:MONTH_DAYS_REGULAR_CUMULATIVE;var yday=monthDaysCumulative[date.getMonth()]+date.getDate()-1;return yday};function __localtime_js(time_low,time_high,tmPtr){var time=convertI32PairToI53Checked(time_low,time_high);var date=new Date(time*1e3);HEAP32[tmPtr>>2]=date.getSeconds();HEAP32[tmPtr+4>>2]=date.getMinutes();HEAP32[tmPtr+8>>2]=date.getHours();HEAP32[tmPtr+12>>2]=date.getDate();HEAP32[tmPtr+16>>2]=date.getMonth();HEAP32[tmPtr+20>>2]=date.getFullYear()-1900;HEAP32[tmPtr+24>>2]=date.getDay();var yday=ydayFromDate(date)|0;HEAP32[tmPtr+28>>2]=yday;HEAP32[tmPtr+36>>2]=-(date.getTimezoneOffset()*60);var start=new Date(date.getFullYear(),0,1);var summerOffset=new Date(date.getFullYear(),6,1).getTimezoneOffset();var winterOffset=start.getTimezoneOffset();var dst=(summerOffset!=winterOffset&&date.getTimezoneOffset()==Math.min(winterOffset,summerOffset))|0;HEAP32[tmPtr+32>>2]=dst}var stringToUTF8=(str,outPtr,maxBytesToWrite)=>stringToUTF8Array(str,HEAPU8,outPtr,maxBytesToWrite);var __tzset_js=(timezone,daylight,std_name,dst_name)=>{var currentYear=(new Date).getFullYear();var winter=new Date(currentYear,0,1);var summer=new Date(currentYear,6,1);var winterOffset=winter.getTimezoneOffset();var summerOffset=summer.getTimezoneOffset();var stdTimezoneOffset=Math.max(winterOffset,summerOffset);HEAPU32[timezone>>2]=stdTimezoneOffset*60;HEAP32[daylight>>2]=Number(winterOffset!=summerOffset);var extractZone=timezoneOffset=>{var sign=timezoneOffset>=0?"-":"+";var absOffset=Math.abs(timezoneOffset);var hours=String(Math.floor(absOffset/60)).padStart(2,"0");var minutes=String(absOffset%60).padStart(2,"0");return`UTC${sign}${hours}${minutes}`};var winterName=extractZone(winterOffset);var summerName=extractZone(summerOffset);if(summerOffset<winterOffset){stringToUTF8(winterName,std_name,17);stringToUTF8(summerName,dst_name,17)}else{stringToUTF8(winterName,dst_name,17);stringToUTF8(summerName,std_name,17)}};var _emscripten_get_now=()=>performance.now();var _emscripten_date_now=()=>Date.now();var nowIsMonotonic=1;var checkWasiClock=clock_id=>clock_id>=0&&clock_id<=3;function _clock_time_get(clk_id,ignored_precision_low,ignored_precision_high,ptime){var ignored_precision=convertI32PairToI53Checked(ignored_precision_low,ignored_precision_high);if(!checkWasiClock(clk_id)){return 28}var now;if(clk_id===0){now=_emscripten_date_now()}else if(nowIsMonotonic){now=_emscripten_get_now()}else{return 52}var nsec=Math.round(now*1e3*1e3);tempI64=[nsec>>>0,(tempDouble=nsec,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[ptime>>2]=tempI64[0],HEAP32[ptime+4>>2]=tempI64[1];return 0}var readEmAsmArgsArray=[];var readEmAsmArgs=(sigPtr,buf)=>{readEmAsmArgsArray.length=0;var ch;while(ch=HEAPU8[sigPtr++]){var wide=ch!=105;wide&=ch!=112;buf+=wide&&buf%8?4:0;readEmAsmArgsArray.push(ch==112?HEAPU32[buf>>2]:ch==105?HEAP32[buf>>2]:HEAPF64[buf>>3]);buf+=wide?8:4}return readEmAsmArgsArray};var runEmAsmFunction=(code,sigPtr,argbuf)=>{var args=readEmAsmArgs(sigPtr,argbuf);return ASM_CONSTS[code](...args)};var _emscripten_asm_const_int=(code,sigPtr,argbuf)=>runEmAsmFunction(code,sigPtr,argbuf);var runAndAbortIfError=func=>{try{return func()}catch(e){abort(e)}};var handleException=e=>{if(e instanceof ExitStatus||e=="unwind"){return EXITSTATUS}quit_(1,e)};var runtimeKeepaliveCounter=0;var keepRuntimeAlive=()=>noExitRuntime||runtimeKeepaliveCounter>0;var _proc_exit=code=>{EXITSTATUS=code;if(!keepRuntimeAlive()){Module["onExit"]?.(code);ABORT=true}quit_(code,new ExitStatus(code))};var exitJS=(status,implicit)=>{EXITSTATUS=status;_proc_exit(status)};var _exit=exitJS;var maybeExit=()=>{if(!keepRuntimeAlive()){try{_exit(EXITSTATUS)}catch(e){handleException(e)}}};var callUserCallback=func=>{if(ABORT){return}try{return func()}catch(e){handleException(e)}finally{maybeExit()}};var runtimeKeepalivePush=()=>{runtimeKeepaliveCounter+=1};var runtimeKeepalivePop=()=>{runtimeKeepaliveCounter-=1};var Asyncify={instrumentWasmImports(imports){var importPattern=/^(libavjs_wait_reader|jsfetch_open_js|jsfetch_read_js|jsfetch_seek_js|invoke_.*|__asyncjs__.*)$/;for(let[x,original]of Object.entries(imports)){if(typeof original=="function"){let isAsyncifyImport=original.isAsync||importPattern.test(x)}}},instrumentFunction(original){var wrapper=(...args)=>{Asyncify.exportCallStack.push(original);try{return original(...args)}finally{if(!ABORT){var top=Asyncify.exportCallStack.pop();Asyncify.maybeStopUnwind()}}};Asyncify.funcWrappers.set(original,wrapper);return wrapper},instrumentWasmExports(exports){var ret={};for(let[x,original]of Object.entries(exports)){if(typeof original=="function"){var wrapper=Asyncify.instrumentFunction(original);ret[x]=wrapper}else{ret[x]=original}}return ret},State:{Normal:0,Unwinding:1,Rewinding:2,Disabled:3},state:0,StackSize:4096,currData:null,handleSleepReturnValue:0,exportCallStack:[],callstackFuncToId:new Map,callStackIdToFunc:new Map,funcWrappers:new Map,callStackId:0,asyncPromiseHandlers:null,sleepCallbacks:[],getCallStackId(func){if(!Asyncify.callstackFuncToId.has(func)){var id=Asyncify.callStackId++;Asyncify.callstackFuncToId.set(func,id);Asyncify.callStackIdToFunc.set(id,func)}return Asyncify.callstackFuncToId.get(func)},maybeStopUnwind(){if(Asyncify.currData&&Asyncify.state===Asyncify.State.Unwinding&&Asyncify.exportCallStack.length===0){Asyncify.state=Asyncify.State.Normal;runAndAbortIfError(_asyncify_stop_unwind);if(typeof Fibers!="undefined"){Fibers.trampoline()}}},whenDone(){return new Promise((resolve,reject)=>{Asyncify.asyncPromiseHandlers={resolve,reject}})},allocateData(){var ptr=_malloc(12+Asyncify.StackSize);Asyncify.setDataHeader(ptr,ptr+12,Asyncify.StackSize);Asyncify.setDataRewindFunc(ptr);return ptr},setDataHeader(ptr,stack,stackSize){HEAPU32[ptr>>2]=stack;HEAPU32[ptr+4>>2]=stack+stackSize},setDataRewindFunc(ptr){var bottomOfCallStack=Asyncify.exportCallStack[0];var rewindId=Asyncify.getCallStackId(bottomOfCallStack);HEAP32[ptr+8>>2]=rewindId},getDataRewindFunc(ptr){var id=HEAP32[ptr+8>>2];var func=Asyncify.callStackIdToFunc.get(id);return func},doRewind(ptr){var original=Asyncify.getDataRewindFunc(ptr);var func=Asyncify.funcWrappers.get(original);return callUserCallback(func)},handleSleep(startAsync){if(ABORT)return;if(Asyncify.state===Asyncify.State.Normal){var reachedCallback=false;var reachedAfterCallback=false;startAsync((handleSleepReturnValue=0)=>{if(ABORT)return;Asyncify.handleSleepReturnValue=handleSleepReturnValue;reachedCallback=true;if(!reachedAfterCallback){return}Asyncify.state=Asyncify.State.Rewinding;runAndAbortIfError(()=>_asyncify_start_rewind(Asyncify.currData));if(typeof MainLoop!="undefined"&&MainLoop.func){MainLoop.resume()}var asyncWasmReturnValue,isError=false;try{asyncWasmReturnValue=Asyncify.doRewind(Asyncify.currData)}catch(err){asyncWasmReturnValue=err;isError=true}var handled=false;if(!Asyncify.currData){var asyncPromiseHandlers=Asyncify.asyncPromiseHandlers;if(asyncPromiseHandlers){Asyncify.asyncPromiseHandlers=null;(isError?asyncPromiseHandlers.reject:asyncPromiseHandlers.resolve)(asyncWasmReturnValue);handled=true}}if(isError&&!handled){throw asyncWasmReturnValue}});reachedAfterCallback=true;if(!reachedCallback){Asyncify.state=Asyncify.State.Unwinding;Asyncify.currData=Asyncify.allocateData();if(typeof MainLoop!="undefined"&&MainLoop.func){MainLoop.pause()}runAndAbortIfError(()=>_asyncify_start_unwind(Asyncify.currData))}}else if(Asyncify.state===Asyncify.State.Rewinding){Asyncify.state=Asyncify.State.Normal;runAndAbortIfError(_asyncify_stop_rewind);_free(Asyncify.currData);Asyncify.currData=null;Asyncify.sleepCallbacks.forEach(callUserCallback)}else{abort(`invalid state: ${Asyncify.state}`)}return Asyncify.handleSleepReturnValue},handleAsync:startAsync=>Asyncify.handleSleep(async wakeUp=>{wakeUp(await startAsync())})};var Fibers={nextFiber:0,trampolineRunning:false,trampoline(){if(!Fibers.trampolineRunning&&Fibers.nextFiber){Fibers.trampolineRunning=true;do{var fiber=Fibers.nextFiber;Fibers.nextFiber=0;Fibers.finishContextSwitch(fiber)}while(Fibers.nextFiber);Fibers.trampolineRunning=false}},finishContextSwitch(newFiber){var stack_base=HEAPU32[newFiber>>2];var stack_max=HEAPU32[newFiber+4>>2];_emscripten_stack_set_limits(stack_base,stack_max);stackRestore(HEAPU32[newFiber+8>>2]);var entryPoint=HEAPU32[newFiber+12>>2];if(entryPoint!==0){Asyncify.currData=null;HEAPU32[newFiber+12>>2]=0;var userData=HEAPU32[newFiber+16>>2];(a1=>dynCall_vi(entryPoint,a1))(userData)}else{var asyncifyData=newFiber+20;Asyncify.currData=asyncifyData;Asyncify.state=Asyncify.State.Rewinding;_asyncify_start_rewind(asyncifyData);Asyncify.doRewind(asyncifyData)}}};var _emscripten_fiber_swap=(oldFiber,newFiber)=>{if(ABORT)return;if(Asyncify.state===Asyncify.State.Normal){Asyncify.state=Asyncify.State.Unwinding;var asyncifyData=oldFiber+20;Asyncify.setDataRewindFunc(asyncifyData);Asyncify.currData=asyncifyData;_asyncify_start_unwind(asyncifyData);var stackTop=stackSave();HEAPU32[oldFiber+8>>2]=stackTop;Fibers.nextFiber=newFiber}else{Asyncify.state=Asyncify.State.Normal;_asyncify_stop_rewind();Asyncify.currData=null}};_emscripten_fiber_swap.isAsync=true;var getHeapMax=()=>2147483648;var _emscripten_get_heap_max=()=>getHeapMax();var alignMemory=(size,alignment)=>Math.ceil(size/alignment)*alignment;var growMemory=size=>{var oldHeapSize=wasmMemory.buffer.byteLength;var pages=(size-oldHeapSize+65535)/65536|0;try{wasmMemory.grow(pages);updateMemoryViews();return 1}catch(e){}};var _emscripten_resize_heap=requestedSize=>{var oldSize=HEAPU8.length;requestedSize>>>=0;var maxHeapSize=getHeapMax();if(requestedSize>maxHeapSize){return false}for(var cutDown=1;cutDown<=4;cutDown*=2){var overGrownHeapSize=oldSize*(1+.2/cutDown);overGrownHeapSize=Math.min(overGrownHeapSize,requestedSize+100663296);var newSize=Math.min(maxHeapSize,alignMemory(Math.max(requestedSize,overGrownHeapSize),65536));var replacement=growMemory(newSize);if(replacement){return true}}return false};var ENV={};var getExecutableName=()=>thisProgram||"./this.program";var getEnvStrings=()=>{if(!getEnvStrings.strings){var lang=(globalThis.navigator?.language??"C").replace("-","_")+".UTF-8";var env={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:lang,_:getExecutableName()};for(var x in ENV){if(ENV[x]===undefined)delete env[x];else env[x]=ENV[x]}var strings=[];for(var x in env){strings.push(`${x}=${env[x]}`)}getEnvStrings.strings=strings}return getEnvStrings.strings};var _environ_get=(__environ,environ_buf)=>{var bufSize=0;var envp=0;for(var string of getEnvStrings()){var ptr=environ_buf+bufSize;HEAPU32[__environ+envp>>2]=ptr;bufSize+=stringToUTF8(string,ptr,Infinity)+1;envp+=4}return 0};var _environ_sizes_get=(penviron_count,penviron_buf_size)=>{var strings=getEnvStrings();HEAPU32[penviron_count>>2]=strings.length;var bufSize=0;for(var string of strings){bufSize+=lengthBytesUTF8(string)+1}HEAPU32[penviron_buf_size>>2]=bufSize;return 0};function _fd_close(fd){try{var stream=SYSCALLS.getStreamFromFD(fd);FS.close(stream);return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}function _fd_fdstat_get(fd,pbuf){try{var rightsBase=0;var rightsInheriting=0;var flags=0;{var stream=SYSCALLS.getStreamFromFD(fd);var type=stream.tty?2:FS.isDir(stream.mode)?3:FS.isLink(stream.mode)?7:4}HEAP8[pbuf]=type;HEAP16[pbuf+2>>1]=flags;tempI64=[rightsBase>>>0,(tempDouble=rightsBase,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[pbuf+8>>2]=tempI64[0],HEAP32[pbuf+12>>2]=tempI64[1];tempI64=[rightsInheriting>>>0,(tempDouble=rightsInheriting,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[pbuf+16>>2]=tempI64[0],HEAP32[pbuf+20>>2]=tempI64[1];return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}var doReadv=(stream,iov,iovcnt,offset)=>{var ret=0;for(var i=0;i<iovcnt;i++){var ptr=HEAPU32[iov>>2];var len=HEAPU32[iov+4>>2];iov+=8;var curr=FS.read(stream,HEAP8,ptr,len,offset);if(curr<0)return-1;ret+=curr;if(curr<len)break;if(typeof offset!="undefined"){offset+=curr}}return ret};function _fd_read(fd,iov,iovcnt,pnum){try{var stream=SYSCALLS.getStreamFromFD(fd);var num=doReadv(stream,iov,iovcnt);HEAPU32[pnum>>2]=num;return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}function _fd_seek(fd,offset_low,offset_high,whence,newOffset){var offset=convertI32PairToI53Checked(offset_low,offset_high);try{if(isNaN(offset))return 22;var stream=SYSCALLS.getStreamFromFD(fd);FS.llseek(stream,offset,whence);tempI64=[stream.position>>>0,(tempDouble=stream.position,+Math.abs(tempDouble)>=1?tempDouble>0?+Math.floor(tempDouble/4294967296)>>>0:~~+Math.ceil((tempDouble-+(~~tempDouble>>>0))/4294967296)>>>0:0)],HEAP32[newOffset>>2]=tempI64[0],HEAP32[newOffset+4>>2]=tempI64[1];if(stream.getdents&&offset===0&&whence===0)stream.getdents=null;return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}var doWritev=(stream,iov,iovcnt,offset)=>{var ret=0;for(var i=0;i<iovcnt;i++){var ptr=HEAPU32[iov>>2];var len=HEAPU32[iov+4>>2];iov+=8;var curr=FS.write(stream,HEAP8,ptr,len,offset);if(curr<0)return-1;ret+=curr;if(curr<len){break}if(typeof offset!="undefined"){offset+=curr}}return ret};function _fd_write(fd,iov,iovcnt,pnum){try{var stream=SYSCALLS.getStreamFromFD(fd);var num=doWritev(stream,iov,iovcnt);HEAPU32[pnum>>2]=num;return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}var getCFunc=ident=>{var func=Module["_"+ident];return func};var writeArrayToMemory=(array,buffer)=>{HEAP8.set(array,buffer)};var stackAlloc=sz=>__emscripten_stack_alloc(sz);var stringToUTF8OnStack=str=>{var size=lengthBytesUTF8(str)+1;var ret=stackAlloc(size);stringToUTF8(str,ret,size);return ret};var ccall=(ident,returnType,argTypes,args,opts)=>{var toC={string:str=>{var ret=0;if(str!==null&&str!==undefined&&str!==0){ret=stringToUTF8OnStack(str)}return ret},array:arr=>{var ret=stackAlloc(arr.length);writeArrayToMemory(arr,ret);return ret}};function convertReturnValue(ret){if(returnType==="string"){return UTF8ToString(ret)}if(returnType==="boolean")return Boolean(ret);return ret}var func=getCFunc(ident);var cArgs=[];var stack=0;if(args){for(var i=0;i<args.length;i++){var converter=toC[argTypes[i]];if(converter){if(stack===0)stack=stackSave();cArgs[i]=converter(args[i])}else{cArgs[i]=args[i]}}}var previousAsync=Asyncify.currData;var ret=func(...cArgs);function onDone(ret){runtimeKeepalivePop();if(stack!==0)stackRestore(stack);return convertReturnValue(ret)}var asyncMode=opts?.async;runtimeKeepalivePush();if(Asyncify.currData!=previousAsync){return Asyncify.whenDone().then(onDone)}ret=onDone(ret);if(asyncMode)return Promise.resolve(ret);return ret};var cwrap=(ident,returnType,argTypes,opts)=>{var numericArgs=!argTypes||argTypes.every(type=>type==="number"||type==="boolean");var numericRet=returnType!=="string";if(numericRet&&numericArgs&&!opts){return getCFunc(ident)}return(...args)=>ccall(ident,returnType,argTypes,args,opts)};FS.createPreloadedFile=FS_createPreloadedFile;FS.preloadFile=FS_preloadFile;FS.staticInit();{if(Module["noExitRuntime"])noExitRuntime=Module["noExitRuntime"];if(Module["preloadPlugins"])preloadPlugins=Module["preloadPlugins"];if(Module["print"])out=Module["print"];if(Module["printErr"])err=Module["printErr"];if(Module["wasmBinary"])wasmBinary=Module["wasmBinary"];if(Module["arguments"])arguments_=Module["arguments"];if(Module["thisProgram"])thisProgram=Module["thisProgram"];if(Module["preInit"]){if(typeof Module["preInit"]=="function")Module["preInit"]=[Module["preInit"]];while(Module["preInit"].length>0){Module["preInit"].shift()()}}}Module["ccall"]=ccall;Module["cwrap"]=cwrap;var ASM_CONSTS={72708:()=>{Fibers.trampolineRunning=false}};var _ff_nothing,_av_opt_set_int_list_js,_av_dict_copy_js,_av_dict_set_js,_av_compare_ts_js,_libavjs_with_swscale,_libavjs_create_main_thread,_ff_error,_mallinfo_uordblks,_LIBAVUTIL_VERSION_INT,_av_strdup,_av_dict_free,_av_log_get_level,_av_log_set_level,_free,_av_opt_set,_open,_sws_scale_frame,_sws_getContext,_sws_freeContext,_emfiberthreads_timeout_expiry,_calloc,_malloc,_close,_dup2,_strerror,__emscripten_tempret_set,_emscripten_stack_set_limits,__emscripten_stack_restore,__emscripten_stack_alloc,_emscripten_stack_get_current,dynCall_ii,dynCall_viiii,dynCall_dd,dynCall_iiii,dynCall_iiiiii,dynCall_iii,dynCall_vii,dynCall_jiji,dynCall_iidiiii,dynCall_iiiii,dynCall_viiiii,dynCall_viiiiiii,dynCall_viiiiiiii,dynCall_viiiiiiiiiiii,dynCall_viiiiiiiiii,dynCall_viiiiiiiii,dynCall_viiiiii,dynCall_vi,dynCall_vddi,dynCall_viii,dynCall_iiiiiiii,dynCall_viiiij,dynCall_viiij,dynCall_v,_asyncify_start_unwind,_asyncify_stop_unwind,_asyncify_start_rewind,_asyncify_stop_rewind,memory,__indirect_function_table,wasmMemory;function assignWasmExports(wasmExports){_ff_nothing=Module["_ff_nothing"]=wasmExports["w"];_av_opt_set_int_list_js=Module["_av_opt_set_int_list_js"]=wasmExports["x"];_av_dict_copy_js=Module["_av_dict_copy_js"]=wasmExports["y"];_av_dict_set_js=Module["_av_dict_set_js"]=wasmExports["z"];_av_compare_ts_js=Module["_av_compare_ts_js"]=wasmExports["A"];_libavjs_with_swscale=Module["_libavjs_with_swscale"]=wasmExports["B"];_libavjs_create_main_thread=Module["_libavjs_create_main_thread"]=wasmExports["C"];_ff_error=Module["_ff_error"]=wasmExports["D"];_mallinfo_uordblks=Module["_mallinfo_uordblks"]=wasmExports["E"];_LIBAVUTIL_VERSION_INT=Module["_LIBAVUTIL_VERSION_INT"]=wasmExports["F"];_av_strdup=Module["_av_strdup"]=wasmExports["G"];_av_dict_free=Module["_av_dict_free"]=wasmExports["H"];_av_log_get_level=Module["_av_log_get_level"]=wasmExports["I"];_av_log_set_level=Module["_av_log_set_level"]=wasmExports["J"];_free=Module["_free"]=wasmExports["K"];_av_opt_set=Module["_av_opt_set"]=wasmExports["L"];_open=Module["_open"]=wasmExports["M"];_sws_scale_frame=Module["_sws_scale_frame"]=wasmExports["N"];_sws_getContext=Module["_sws_getContext"]=wasmExports["O"];_sws_freeContext=Module["_sws_freeContext"]=wasmExports["P"];_emfiberthreads_timeout_expiry=Module["_emfiberthreads_timeout_expiry"]=wasmExports["Q"];_calloc=Module["_calloc"]=wasmExports["R"];_malloc=Module["_malloc"]=wasmExports["S"];_close=Module["_close"]=wasmExports["T"];_dup2=Module["_dup2"]=wasmExports["U"];_strerror=Module["_strerror"]=wasmExports["V"];__emscripten_tempret_set=wasmExports["W"];_emscripten_stack_set_limits=wasmExports["X"];__emscripten_stack_restore=wasmExports["Y"];__emscripten_stack_alloc=wasmExports["Z"];_emscripten_stack_get_current=wasmExports["_"];dynCall_ii=dynCalls["ii"]=wasmExports["$"];dynCall_viiii=dynCalls["viiii"]=wasmExports["aa"];dynCall_dd=dynCalls["dd"]=wasmExports["ba"];dynCall_iiii=dynCalls["iiii"]=wasmExports["ca"];dynCall_iiiiii=dynCalls["iiiiii"]=wasmExports["da"];dynCall_iii=dynCalls["iii"]=wasmExports["ea"];dynCall_vii=dynCalls["vii"]=wasmExports["fa"];dynCall_jiji=dynCalls["jiji"]=wasmExports["ga"];dynCall_iidiiii=dynCalls["iidiiii"]=wasmExports["ha"];dynCall_iiiii=dynCalls["iiiii"]=wasmExports["ia"];dynCall_viiiii=dynCalls["viiiii"]=wasmExports["ja"];dynCall_viiiiiii=dynCalls["viiiiiii"]=wasmExports["ka"];dynCall_viiiiiiii=dynCalls["viiiiiiii"]=wasmExports["la"];dynCall_viiiiiiiiiiii=dynCalls["viiiiiiiiiiii"]=wasmExports["ma"];dynCall_viiiiiiiiii=dynCalls["viiiiiiiiii"]=wasmExports["na"];dynCall_viiiiiiiii=dynCalls["viiiiiiiii"]=wasmExports["oa"];dynCall_viiiiii=dynCalls["viiiiii"]=wasmExports["pa"];dynCall_vi=dynCalls["vi"]=wasmExports["qa"];dynCall_vddi=dynCalls["vddi"]=wasmExports["ra"];dynCall_viii=dynCalls["viii"]=wasmExports["sa"];dynCall_iiiiiiii=dynCalls["iiiiiiii"]=wasmExports["ta"];dynCall_viiiij=dynCalls["viiiij"]=wasmExports["ua"];dynCall_viiij=dynCalls["viiij"]=wasmExports["va"];dynCall_v=dynCalls["v"]=wasmExports["wa"];_asyncify_start_unwind=wasmExports["xa"];_asyncify_stop_unwind=wasmExports["ya"];_asyncify_start_rewind=wasmExports["za"];_asyncify_stop_rewind=wasmExports["Aa"];memory=wasmMemory=wasmExports["u"];__indirect_function_table=wasmExports["__indirect_function_table"]}var wasmImports={m:___syscall_dup3,a:___syscall_fcntl64,i:___syscall_ioctl,p:___syscall_openat,g:__abort_js,j:__localtime_js,q:__tzset_js,l:_clock_time_get,t:_emscripten_asm_const_int,f:_emscripten_date_now,s:_emscripten_fiber_swap,n:_emscripten_get_heap_max,o:_emscripten_resize_heap,r:_environ_get,e:_environ_sizes_get,c:_fd_close,d:_fd_fdstat_get,h:_fd_read,k:_fd_seek,b:_fd_write};function run(){if(runDependencies>0){dependenciesFulfilled=run;return}preRun();if(runDependencies>0){dependenciesFulfilled=run;return}function doRun(){Module["calledRun"]=true;if(ABORT)return;initRuntime();readyPromiseResolve?.(Module);Module["onRuntimeInitialized"]?.();postRun()}if(Module["setStatus"]){Module["setStatus"]("Running...");setTimeout(()=>{setTimeout(()=>Module["setStatus"](""),1);doRun()},1)}else{doRun()}}var wasmExports;wasmExports=await (createWasm());run();var serializationPromise=null;function serially(f){var p;if(serializationPromise){p=serializationPromise.catch(function(){}).then(function(){return f()})}else{p=f()}serializationPromise=p=p.finally(function(){if(serializationPromise===p)serializationPromise=null});return p}Module.fsThrownError=null;var CAccessors={};var ff_malloc_int32_list=Module.ff_malloc_int32_list=function(list){var ptr=malloc(list.length*4);if(ptr===0)throw new Error("Failed to malloc");var arr=new Uint32Array(Module.HEAPU8.buffer,ptr,list.length);for(var i=0;i<list.length;i++)arr[i]=list[i];return ptr};var ff_malloc_int64_list=Module.ff_malloc_int64_list=function(list){var ptr=malloc(list.length*8);if(ptr===0)throw new Error("Failed to malloc");var arr=new Int32Array(Module.HEAPU8.buffer,ptr,list.length*2);for(var i=0;i<list.length;i++){arr[i*2]=list[i];arr[i*2+1]=list[i]<0?-1:0}return ptr};var ff_malloc_string_array=Module.ff_malloc_string_array=function(arr){var ptr=malloc((arr.length+1)*4);if(ptr===0)throw new Error("Failed to malloc");var inArr=new Uint32Array(Module.HEAPU8.buffer,ptr,arr.length+1);var i;for(i=0;i<arr.length;i++)inArr[i]=av_strdup(arr[i]);inArr[i]=0;return ptr};var ff_free_string_array=Module.ff_free_string_array=function(ptr){var iPtr=ptr/4;for(;;iPtr++){var elPtr=Module.HEAPU32[iPtr];if(!elPtr)break;free(elPtr)}free(ptr)};var calloc=Module.calloc=CAccessors.calloc=Module.cwrap("calloc","number",["number","number"]);var close=Module.close=CAccessors.close=Module.cwrap("close","number",["number"]);var dup2=Module.dup2=CAccessors.dup2=Module.cwrap("dup2","number",["number","number"]);var free=Module.free=CAccessors.free=Module.cwrap("free",null,["number"]);var malloc=Module.malloc=CAccessors.malloc=Module.cwrap("malloc","number",["number"]);var mallinfo_uordblks=Module.mallinfo_uordblks=CAccessors.mallinfo_uordblks=Module.cwrap("mallinfo_uordblks","number",[]);var open=Module.open=CAccessors.open=Module.cwrap("open","number",["string","number","number"]);var strerror=Module.strerror=CAccessors.strerror=Module.cwrap("strerror","string",["number"]);var libavjs_create_main_thread=Module.libavjs_create_main_thread=CAccessors.libavjs_create_main_thread=Module.cwrap("libavjs_create_main_thread","number",[]);var libavjs_with_swscale=Module.libavjs_with_swscale=CAccessors.libavjs_with_swscale=Module.cwrap("libavjs_with_swscale","number",[]);var copyin_u8=Module.copyin_u8=CAccessors.copyin_u8=function(ptr,arr){var buf=new Uint8Array(Module.HEAPU8.buffer,ptr);buf.set(arr)};var copyout_u8=Module.copyout_u8=CAccessors.copyout_u8=function(ptr,len){var ret=new Uint8Array(Module.HEAPU8.buffer,ptr,len).slice(0);ret.libavjsTransfer=[ret.buffer];return ret};var copyin_s16=Module.copyin_s16=CAccessors.copyin_s16=function(ptr,arr){var buf=new Int16Array(Module.HEAPU8.buffer,ptr);buf.set(arr)};var copyout_s16=Module.copyout_s16=CAccessors.copyout_s16=function(ptr,len){var ret=new Int16Array(Module.HEAPU8.buffer,ptr,len).slice(0);ret.libavjsTransfer=[ret.buffer];return ret};var copyin_s32=Module.copyin_s32=CAccessors.copyin_s32=function(ptr,arr){var buf=new Int32Array(Module.HEAPU8.buffer,ptr);buf.set(arr)};var copyout_s32=Module.copyout_s32=CAccessors.copyout_s32=function(ptr,len){var ret=new Int32Array(Module.HEAPU8.buffer,ptr,len).slice(0);ret.libavjsTransfer=[ret.buffer];return ret};var copyin_f32=Module.copyin_f32=CAccessors.copyin_f32=function(ptr,arr){var buf=new Float32Array(Module.HEAPU8.buffer,ptr);buf.set(arr)};var copyout_f32=Module.copyout_f32=CAccessors.copyout_f32=function(ptr,len){var ret=new Float32Array(Module.HEAPU8.buffer,ptr,len).slice(0);ret.libavjsTransfer=[ret.buffer];return ret};var av_compare_ts_js=Module.av_compare_ts_js=CAccessors.av_compare_ts_js=Module.cwrap("av_compare_ts_js","number",["number","number","number","number","number","number","number","number"]);var av_dict_copy_js=Module.av_dict_copy_js=CAccessors.av_dict_copy_js=Module.cwrap("av_dict_copy_js","number",["number","number","number"]);var av_dict_free=Module.av_dict_free=CAccessors.av_dict_free=Module.cwrap("av_dict_free",null,["number"]);var av_dict_set_js=Module.av_dict_set_js=CAccessors.av_dict_set_js=Module.cwrap("av_dict_set_js","number",["number","string","string","number"]);var av_log_get_level=Module.av_log_get_level=CAccessors.av_log_get_level=Module.cwrap("av_log_get_level","number",[]);var av_log_set_level=Module.av_log_set_level=CAccessors.av_log_set_level=Module.cwrap("av_log_set_level",null,["number"]);var av_opt_set=Module.av_opt_set=CAccessors.av_opt_set=Module.cwrap("av_opt_set","number",["number","string","string","number"]);var av_opt_set_int_list_js=Module.av_opt_set_int_list_js=CAccessors.av_opt_set_int_list_js=Module.cwrap("av_opt_set_int_list_js","number",["number","string","number","number","number","number"]);var av_strdup=Module.av_strdup=CAccessors.av_strdup=Module.cwrap("av_strdup","number",["string"]);var ff_error=Module.ff_error=CAccessors.ff_error=Module.cwrap("ff_error","string",["number"]);var ff_nothing=Module.ff_nothing=CAccessors.ff_nothing=Module.cwrap("ff_nothing",null,[],{async:true});Module.ff_nothing=function(){var args=arguments;return serially(function(){return ff_nothing.apply(void 0,args)})};var LIBAVUTIL_VERSION_INT=Module.LIBAVUTIL_VERSION_INT=CAccessors.LIBAVUTIL_VERSION_INT=Module.cwrap("LIBAVUTIL_VERSION_INT","number",[]);var av_dict_free_js=Module.av_dict_free_js=CAccessors.av_dict_free_js=function(p){var p2=malloc(4);if(p2===0)throw new Error("Could not malloc");new Uint32Array(Module.HEAPU8.buffer,p2,1)[0]=p;CAccessors.av_dict_free(p2);free(p2)};var sws_getContext=Module.sws_getContext=CAccessors.sws_getContext=Module.cwrap("sws_getContext","number",["number","number","number","number","number","number","number","number","number","number"]);var sws_freeContext=Module.sws_freeContext=CAccessors.sws_freeContext=Module.cwrap("sws_freeContext",null,["number"]);var sws_scale_frame=Module.sws_scale_frame=CAccessors.sws_scale_frame=Module.cwrap("sws_scale_frame","number",["number","number","number"]);if(runtimeInitialized){moduleRtn=Module}else{moduleRtn=new Promise((resolve,reject)=>{readyPromiseResolve=resolve;readyPromiseReject=reject})}
;return moduleRtn}export default LibAVFactory;
/*
 * Copyright (C) 2019-2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

if (/* We're in a worker */
    typeof importScripts !== "undefined" &&
    /* We're not being loaded with noworker from the main code */
    typeof LibAV === "undefined" &&
    /* We're not being loaded as a thread */
    (
        (typeof self === "undefined" && typeof Module === "undefined") ||
        (typeof self !== "undefined" && self.name !== "em-pthread")
    )
    ) (function() {
    var libav;

    Promise.all([]).then(function() {
        /* We're the primary code for this worker. The host should ask us to
         * load immediately. */
        return new Promise(function(res, rej) {
            onmessage = function(e) {
                if (e && e.data && e.data.config) {
                    LibAVFactory({
                        wasmurl: e.data.config.wasmurl,
                        variant: e.data.config.variant
                    }).then(res).catch(rej);
                }
            };
        });

    }).then(function(lib) {
        libav = lib;

        // Now we're ready for normal messages
        onmessage = function(e) {
            var id = e.data[0];
            var fun = e.data[1];
            var args = e.data.slice(2);
            var ret = void 0;
            var succ = true;

            function reply() {
                var transfer = [];
                if (ret && ret.libavjsTransfer)
                    transfer = ret.libavjsTransfer
                try {
                    postMessage([id, fun, succ, ret], transfer);
                } catch (ex) {
                    try {
                        ret = JSON.parse(JSON.stringify(
                            ret, function(k, v) { return v; }
                        ));
                        postMessage([id, fun, succ, ret], transfer);
                    } catch (ex) {
                        postMessage([id, fun, succ, "" + ret]);
                    }
                }
            }

            try {
                ret = libav[fun].apply(libav, args);
            } catch (ex) {
                succ = false;
                ret = ex;
            }
            if (succ && ret && ret.then) {
                // Let the promise resolve
                ret.then(function(res) {
                    ret = res;
                }).catch(function(ex) {
                    succ = false;
                    ret = ex;
                }).then(reply);

            } else reply();
        };

        libav.onwrite = function(name, pos, buf) {
            /* We have to buf.slice(0) so we don't duplicate the entire heap just
             * to get one part of it in postMessage */
            buf = buf.slice(0);
            postMessage(["onwrite", "onwrite", true, [name, pos, buf]], [buf.buffer]);
        };

        libav.onread = function(name, pos, len) {
            postMessage(["onread", "onread", true, [name, pos, len]]);
        };

        libav.onblockread = function(name, pos, len) {
            postMessage(["onblockread", "onblockread", true, [name, pos, len]]);
        };

        postMessage(["onready", "onready", true, null]);

    }).catch(function(ex) {
        try {
            postMessage(["error", "error", false, ex]);
        } catch (_) {
            postMessage(["error", "error", false, ex + "\n" + ex.stack]);
        }
        console.log("Loading LibAV failed\n" + ex + "\n" + ex.stack);
    });
})();
